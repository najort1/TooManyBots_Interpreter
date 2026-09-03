const LABELS = ['CAPA', 'MANCHETES', 'DETALHES', 'CITACOES', 'FECHO'];

function extractLabel(text, label) {
  const next = LABELS.filter((item) => item !== label).join('|');
  const expression = new RegExp(`(?:^|\\n)${label}:\\s*([\\s\\S]*?)(?=\\n(?:${next}):|$)`, 'i');
  const value = text.match(expression)?.[1]?.trim() || '';
  return value.length >= 3 ? value : '';
}

function allowedNames(conversation) {
  return new Set(conversation.messages.map((message) => String(message.name || '').toLowerCase()).filter(Boolean));
}

function sanitizeLines(value, maxLines = 4, maxChars = 800) {
  return String(value || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```[\s\S]*?```/g, '')
    .split('\n')
    .map((line) => line.replace(/^[-•]\s*/, '').trim())
    .filter(Boolean)
    .filter((line) => !/^(aqui vai|segue|claro|contexto|regras?|raciocínio|thinking)/i.test(line))
    .slice(0, maxLines)
    .join('\n')
    .slice(0, maxChars)
    .trim();
}

function validateQuotedLines(value, conversation) {
  const sourceQuotes = new Set(conversation.quotes.map((quote) => quote.text.toLowerCase()));
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
  const quotedNames = String(value || '').match(/\b([A-ZÀ-Ý][A-Za-zÀ-ÿ'-]{2,})\s+(?:disse|falou|voltou|abriu|confirmou|entrou|respondeu)\b/gi) || [];
  return quotedNames.some((phrase) => {
    const name = phrase.split(/\s+/)[0].toLowerCase();
    return !names.has(name);
  });
}

function stripUnsupportedParticipantAttributions(value, conversation) {
  const names = allowedNames(conversation);
  return safeLines(value, 4, 1000)
    .filter((line) => {
      const match = line.match(/\b([A-ZÀ-Ý][A-Za-zÀ-ÿ'-]{2,})\s+(?:disse|falou|voltou|abriu|confirmou|entrou|respondeu)\b/i);
      return !match || names.has(match[1].toLowerCase());
    })
    .join('\n');
}

export function parseConversationEdition(raw, conversation) {
  const text = String(raw || '').replace(/\r/g, '').trim();
  if (!text || text.length < 30) return null;
  const edition = {
    capa: sanitizeLines(extractLabel(text, 'CAPA'), 1, 180),
    manchetes: sanitizeLines(extractLabel(text, 'MANCHETES'), 4, 500),
    detalhes: sanitizeLines(extractLabel(text, 'DETALHES'), 4, 1000),
    citacoes: validateQuotedLines(extractLabel(text, 'CITACOES'), conversation),
    fecho: sanitizeLines(extractLabel(text, 'FECHO'), 1, 260),
  };
  if (!edition.capa || (!edition.manchetes && !edition.detalhes)) return null;
  if (hasUnsupportedParticipantName(`${edition.manchetes}\n${edition.detalhes}`, conversation)) {
    edition.manchetes = stripUnsupportedParticipantAttributions(edition.manchetes, conversation);
    edition.detalhes = stripUnsupportedParticipantAttributions(edition.detalhes, conversation);
  }
  return edition.manchetes || edition.detalhes ? edition : null;
}

export async function composeLlmBits(conversation, flavorService, scopeKey, _random = Math.random, _groupMemoryService = null, funConfig = {}) {
  if (!flavorService || typeof flavorService.line !== 'function' || conversation.quiet) return null;

  try {
    const raw = await flavorService.line('group_times', {
      scopeKey: String(scopeKey || ''),
      mood: conversation.mood,
      messageCount: conversation.totalMessageCount,
      participantCount: conversation.participantCount,
      timeline: conversation.timeline
        .map((block) => `${block.hour}: ${block.messageCount} msgs, participantes ${block.participants.join(', ') || 'não identificados'}`)
        .join('\n'),
      conversation: conversation.conversation,
      sourceQuotes: conversation.quotes.map((quote) => `${quote.name}: “${quote.text}”`).join('\n') || 'nenhuma citação segura selecionada',
      historicalMoods: conversation.historicalMoods.join(', ') || 'sem histórico',
      groupNewsConversationMaxChars: funConfig.groupNewsConversationMaxChars,
    });
    const provider = typeof flavorService.lastProvider === 'function' ? flavorService.lastProvider() : '';
    if (String(provider).includes('template')) return null;
    return parseConversationEdition(typeof raw === 'string' ? raw : raw?.text, conversation);
  } catch {
    return null;
  }
}
