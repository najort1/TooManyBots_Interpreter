const LABELS = [
  'CAPA',
  'INTRO',
  'EDITORIAL',
  'MANCHETES',
  'COMENTARISTA',
  'DETALHES',
  'CITACOES',
  'CITAÇÕES',
  'FORESHADOW',
  'FECHO',
];

function normalizeSectionHeaders(text) {
  let normalized = String(text || '').replace(/\r/g, '');
  for (const label of LABELS) {
    // Tolera Markdown em negrito/itálico/título: **CAPA:**, *CAPA*:, ### CAPA:, etc.
    const regex = new RegExp(`^[\\s*#_-]*${label}[\\s*#_-]*:\\s*`, 'gim');
    normalized = normalized.replace(regex, `${label}: `);
  }
  return normalized;
}

function extractLabel(text, label) {
  const normalized = normalizeSectionHeaders(text);
  const next = LABELS.filter((item) => item !== label).join('|');
  const expression = new RegExp(`(?:^|\\n)${label}:\\s*([\\s\\S]*?)(?=\\n(?:${next}):|$)`, 'i');
  const value = normalized.match(expression)?.[1]?.trim() || '';
  return value.length >= 3 ? value : '';
}

function allowedNames(conversation) {
  const msgs = Array.isArray(conversation?.messages) ? conversation.messages : [];
  return new Set(msgs.map((message) => String(message.name || '').toLowerCase()).filter(Boolean));
}

/**
 * Sanitiza o texto da seção narrativa eliminando ruídos, metadados e marcadores de bullet.
 * Suporta teto opcional de caracteres cortando de forma limpa na pontuação da última frase.
 */
export function sanitizeNarrativeSection(value, maxChars = Infinity) {
  const sanitized = String(value || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```[\s\S]*?```/g, '')
    .split('\n')
    .map((line) => line.replace(/^[-•*]\s*/, '').trim())
    .filter(Boolean)
    .filter((line) => !/^(aqui vai|segue|claro|contexto|regras?|raciocínio|thinking)/i.test(line))
    .join('\n')
    .trim();

  if (!Number.isFinite(maxChars) || maxChars <= 0 || sanitized.length <= maxChars) {
    return sanitized;
  }

  const sliced = sanitized.slice(0, maxChars);
  const lastSentenceBreak = Math.max(
    sliced.lastIndexOf('. '),
    sliced.lastIndexOf('.\n'),
    sliced.lastIndexOf('!\n'),
    sliced.lastIndexOf('?\n'),
    sliced.lastIndexOf('! '),
    sliced.lastIndexOf('? ')
  );
  if (lastSentenceBreak > Math.floor(maxChars * 0.4)) {
    return sliced.slice(0, lastSentenceBreak + 1).trim();
  }
  const lastCommaOrLine = Math.max(sliced.lastIndexOf(', '), sliced.lastIndexOf('\n'));
  if (lastCommaOrLine > Math.floor(maxChars * 0.4)) {
    return `${sliced.slice(0, lastCommaOrLine).trim()}...`;
  }
  const lastSpace = sliced.lastIndexOf(' ');
  return `${(lastSpace > 30 ? sliced.slice(0, lastSpace) : sliced).trim()}…`;
}

/** Wrapper para retrocompatibilidade; sem truncamentos forçados por padrão. */
export function sanitizeLines(value, maxLines = Infinity, maxChars = Infinity) {
  const sanitized = sanitizeNarrativeSection(value, maxChars);
  if (!Number.isFinite(maxLines)) {
    return sanitized;
  }
  const lines = sanitized.split('\n');
  const sliced = Number.isFinite(maxLines) && maxLines > 0 ? lines.slice(0, maxLines) : lines;
  return sliced.join('\n').trim();
}

function validateQuotedLines(value, conversation) {
  const quotesList = Array.isArray(conversation?.quotes) ? conversation.quotes : [];
  const sourceQuotes = new Set(quotesList.map((quote) => String(quote.text || '').toLowerCase()));
  const names = allowedNames(conversation);
  const output = [];
  for (const line of String(value || '').split('\n')) {
    const match = line.match(/^([^:]{1,50}):\s*[“"]?(.+?)[”"]?$/);
    if (!match) continue;
    const name = match[1].trim().toLowerCase();
    const quote = match[2].trim().replace(/[”"]$/, '');
    if (!names.has(name)) continue;
    if (![...sourceQuotes].some((source) => source === quote.toLowerCase())) continue;
    output.push(`${match[1].trim()}: “${quote}”`);
    if (output.length >= 3) break;
  }
  return output.join('\n');
}

function hasUnsupportedParticipantName(value, conversation) {
  const names = allowedNames(conversation);
  if (!names.size) return false;
  const quotedNames = String(value || '').match(/\b([A-ZÀ-Ý][A-Za-zÀ-ÿ'-]{2,})\s+(?:disse|falou|voltou|abriu|confirmou|entrou|respondeu)\b/gi) || [];
  return quotedNames.some((phrase) => {
    const name = phrase.split(/\s+/)[0].toLowerCase();
    return !names.has(name);
  });
}

function stripUnsupportedParticipantAttributions(value, conversation) {
  const names = allowedNames(conversation);
  if (!names.size) return String(value || '').trim();
  return String(value || '')
    .split('\n')
    .filter((line) => {
      const match = line.match(/\b([A-ZÀ-Ý][A-Za-zÀ-ÿ'-]{2,})\s+(?:disse|falou|voltou|abriu|confirmou|entrou|respondeu)\b/i);
      return !match || names.has(match[1].toLowerCase());
    })
    .join('\n')
    .trim();
}

export function parseConversationEdition(raw, conversation) {
  const text = String(raw || '').replace(/\r/g, '').trim();
  if (!text || text.length < 30) return null;

  const quotesRaw = extractLabel(text, 'CITACOES') || extractLabel(text, 'CITAÇÕES');
  const capa = sanitizeNarrativeSection(extractLabel(text, 'CAPA'), 160);
  const intro = sanitizeNarrativeSection(
    extractLabel(text, 'INTRO') || extractLabel(text, 'EDITORIAL') || extractLabel(text, 'MANCHETES'),
    650
  );
  const comentarista = sanitizeNarrativeSection(extractLabel(text, 'COMENTARISTA'), 500);
  const detalhes = sanitizeNarrativeSection(extractLabel(text, 'DETALHES'), 800);
  const citacoes = validateQuotedLines(quotesRaw, conversation);
  const foreshadow = sanitizeNarrativeSection(
    extractLabel(text, 'FORESHADOW') || extractLabel(text, 'FECHO'),
    250
  );

  const edition = {
    capa,
    intro,
    manchetes: intro, // retrocompatibilidade
    comentarista,
    detalhes,
    citacoes,
    foreshadow,
    fecho: foreshadow, // retrocompatibilidade
  };

  if (!edition.capa || (!edition.intro && !edition.detalhes && !edition.comentarista)) return null;

  if (hasUnsupportedParticipantName(`${edition.intro}\n${edition.detalhes}\n${edition.comentarista}`, conversation)) {
    edition.intro = stripUnsupportedParticipantAttributions(edition.intro, conversation);
    edition.manchetes = edition.intro;
    edition.detalhes = stripUnsupportedParticipantAttributions(edition.detalhes, conversation);
    edition.comentarista = stripUnsupportedParticipantAttributions(edition.comentarista, conversation);
  }

  return edition.intro || edition.detalhes || edition.comentarista ? edition : null;
}

export async function composeLlmBits(
  conversation,
  flavorService,
  scopeKey,
  _random = Math.random,
  _groupMemoryService = null,
  funConfig = {},
  extraContext = {}
) {
  if (!flavorService || typeof flavorService.line !== 'function' || conversation.quiet) return null;

  try {
    const timelineFormatted = Array.isArray(conversation.timeline)
      ? conversation.timeline
          .map((block) => `${block.hour}: ${block.messageCount} msgs, participantes ${block.participants.join(', ') || 'não identificados'}`)
          .join('\n')
      : 'sem linha do tempo';

    const quotesFormatted = Array.isArray(conversation.quotes)
      ? conversation.quotes.map((quote) => `${quote.name}: “${quote.text}”`).join('\n')
      : '';

    const raw = await flavorService.line('group_times', {
      scopeKey: String(scopeKey || ''),
      mood: conversation.mood,
      messageCount: conversation.totalMessageCount,
      participantCount: conversation.participantCount,
      timeline: timelineFormatted,
      conversation: conversation.conversation,
      sourceQuotes: quotesFormatted || 'nenhuma citação segura selecionada',
      historicalMoods: Array.isArray(conversation.historicalMoods)
        ? conversation.historicalMoods.join(', ')
        : 'sem histórico',
      groupNewsConversationMaxChars: funConfig.groupNewsConversationMaxChars,
      commentator: extraContext.commentator || null,
      groupStyle: extraContext.groupStyle || '',
      socialVibe: extraContext.socialVibe || '',
      groupLore: extraContext.groupLore || '',
    });
    const provider = typeof flavorService.lastProvider === 'function' ? flavorService.lastProvider(scopeKey) : '';
    if (String(provider).includes('template')) return null;
    const parsed = parseConversationEdition(typeof raw === 'string' ? raw : raw?.text, conversation);
    if (!parsed) {
      console.warn(
        `[fun/news] parse failed for scope=${String(scopeKey).slice(0, 28)} (raw length=${String(raw || '').length})`
      );
    }
    return parsed;
  } catch (error) {
    console.warn(`[fun/news] llm error scope=${String(scopeKey).slice(0, 28)}: ${error?.message || error}`);
    return null;
  }
}
