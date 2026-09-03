function safeLines(value, max = 4) {
  return String(value || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, max);
}

function fallbackHeadline(conversation) {
  const headlines = {
    zoeiro: 'O grupo encontrou tempo para rir de absolutamente tudo',
    movimentado: 'A redação pediu água. O grupo pediu mais assunto',
    conversado: 'O grupo conversou, discordou e ninguém foi embora',
    silencioso: 'Plantão vazio: até o “bom dia” pediu folga',
  };
  return headlines[conversation.mood] || headlines.conversado;
}

function fallbackHeadlines(conversation) {
  const timeline = conversation.timeline;
  if (!timeline.length) return [];
  return timeline.slice(0, 3).map((block) => {
    const people = block.participants.length ? block.participants.join(', ') : 'a redação';
    return `• *${block.hour}*: ${people} movimentaram ${block.messageCount} mensagem${block.messageCount === 1 ? '' : 'ens'}.`;
  });
}

function fallbackDetails(conversation) {
  const samples = conversation.timeline
    .flatMap((block) => block.sample)
    .filter((sample) => sample.text.length >= 16)
    .slice(0, 3);
  if (!samples.length) return [];
  return [
    '*A pauta que sobrou*',
    ...samples.map((sample) => `• ${sample.name} entrou na discussão com “${sample.text.slice(0, 180)}${sample.text.length > 180 ? '…' : ''}”`),
  ];
}

function quietEdition(dayLabel) {
  return [
    '📰 *THE GROUP TIMES*',
    dayLabel,
    '',
    '*Plantão do silêncio*',
    'O grupo passou o dia em modo economia de palavras. A redação investigou e descobriu: ninguém tinha fofoca suficiente para abrir uma CPI.',
    '',
    '_Amanhã a gente tenta de novo. Com menos paz, se possível._',
  ].join('\n');
}

export function renderEdition(conversation, llmBits, { dayLabel = '' } = {}) {
  if (conversation?.quiet) return quietEdition(dayLabel);
  const safeConversation = {
    mood: conversation?.mood || 'conversado',
    timeline: Array.isArray(conversation?.timeline) ? conversation.timeline : [],
    quotes: Array.isArray(conversation?.quotes) ? conversation.quotes : [],
  };
  if (!safeConversation.timeline.length && conversation?.society?.despedidas) {
    const top = conversation.society.topFarewellUsers?.[0];
    const who = top ? String(top.jid || '').split('@')[0] : 'alguém';
    return [
      '📰 *THE GROUP TIMES*',
      dayLabel,
      '',
      '*Plantão social*',
      `• Foram ${conversation.society.despedidas} despedidas no grupo. ${who} claramente levou a cerimônia a sério.`,
      '',
      '_A redação deseja boa sorte a quem insistiu em dizer tchau._',
    ].join('\n');
  }

  const headline = llmBits?.capa || fallbackHeadline(safeConversation);
  const headlines = llmBits?.manchetes
    ? safeLines(llmBits.manchetes, 4).map((line) => `• ${line}`)
    : fallbackHeadlines(safeConversation);
  const details = llmBits?.detalhes ? safeLines(llmBits.detalhes, 4) : fallbackDetails(safeConversation);
  const quotes = llmBits?.citacoes
    ? safeLines(llmBits.citacoes, 3)
    : safeConversation.quotes.map((quote) => `${quote.name}: “${quote.text}”`);
  const close = llmBits?.fecho || 'Amanhã tem mais capítulo, desde que alguém apareça com uma versão diferente da mesma história.';

  const sections = [
    '📰 *THE GROUP TIMES*',
    dayLabel,
    '',
    `*${headline}*`,
    '',
    '*MANCHETES*',
    ...headlines,
  ];

  if (details.length) sections.push('', '*POR DENTRO DA FOFOCA*', ...details);
  if (quotes.length) sections.push('', '*FRASES PARA O ARQUIVO*', ...quotes.map((quote) => `• ${quote}`));
  sections.push('', `_${close}_`);

  const text = sections.join('\n').trim();
  return text.length > 3590 ? `${text.slice(0, 3589).trim()}…` : text;
}
