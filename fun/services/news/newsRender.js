/**
 * Renderizador da Edição Diária do Jornal The Group Times (23:59).
 *
 * Transforma fatos e reflexões em uma narrativa jornalística opinativa,
 * sarcástica e fluida, sem listas de tópicos robóticos, sem marcadores
 * mecânicos e sem limites arbitrários de caracteres.
 */

function cleanParagraph(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.replace(/^[-•*]\s*/, '').trim())
    .filter(Boolean)
    .join('\n');
}

function fallbackHeadline(conversation) {
  const headlines = {
    zoeiro: 'Plantão do Deboche: O dia em que a seriedade foi cancelada por unanimidade',
    movimentado: 'Caos Generalizado: A redação pediu água enquanto o grupo empilhava assunto',
    conversado: 'Crônica da Fofoca: Conversas cruzadas, pequenas intrigas e zero resoluções práticas',
    silencioso: 'Plantão do Vácuo Cósmico: Até o bom dia tirou folga da redação',
  };
  return headlines[conversation.mood] || headlines.conversado;
}

function fallbackIntro(conversation) {
  const timeline = Array.isArray(conversation.timeline) ? conversation.timeline : [];
  const participants = [...new Set(timeline.flatMap((b) => b.participants || []))];
  const mainActors = participants.length ? participants.slice(0, 3).join(', ') : 'os suspeitos de sempre';

  const intros = {
    zoeiro: `Se havia alguma chance de debate sério hoje, ela foi enterrada logo nas primeiras horas. Liderados pela disposição inabalável de ${mainActors}, o grupo dedicou cada mensagem à nobre arte de rir da própria desgraça e transformar qualquer detalhe em motivo de chacota coletiva.`,
    movimentado: `O expediente na redação foi um teste de resistência para quem tentou acompanhar a linha de raciocínio. ${mainActors} puxaram o ritmo de um bate-papo frenético, onde cada notificação parecia inaugurar uma nova crise diplomática ou um capítulo inédito de novela.`,
    conversado: `O dia correu naquele tom clássico de mesa de boteco: assuntos que começaram do nada, renderam comentários apaixonados e terminaram sem ninguém admitir que estava errado. ${mainActors} sustentaram a pauta com a firmeza de quem não tem pressa de sair do chat.`,
    silencioso: `Um silêncio quase ensurdecedor tomou conta do recinto. Por longas horas, a sensação era de que todos os membros haviam sido abduzidos ou resolveram, coincidentemente, cumprir a jornada de trabalho.`,
  };

  return intros[conversation.mood] || intros.conversado;
}

function fallbackDetails(conversation) {
  const timeline = Array.isArray(conversation.timeline) ? conversation.timeline : [];
  const samples = timeline
    .flatMap((block) => block.sample || [])
    .filter((s) => s && String(s.text || '').length >= 12)
    .slice(0, 3);

  if (!samples.length) {
    return 'Nos bastidores, os repórteres vasculharam os registros em busca de grandes revelações, mas encontraram apenas o rastro habitual de reações desencontradas e meias-palavras soltas ao vento.';
  }

  if (samples.length === 1) {
    const s0 = samples[0];
    const textSnippet = String(s0.text).replace(/\s+/g, ' ').trim();
    return `Durante a movimentação da apuração, ${s0.name} chamou a atenção dos presentes ao disparar: “${textSnippet}”. A colocação resumiu bem o espírito dos acontecimentos e serviu de combustível para que a prosa continuasse girando sem destino certo.`;
  }

  const narratives = samples.map((sample, index) => {
    const textSnippet = String(sample.text).replace(/\s+/g, ' ').trim();
    if (index === 0) {
      return `Durante a movimentação da apuração, ${sample.name} chamou a atenção dos presentes ao disparar: “${textSnippet}”. A colocação serviu de combustível para que o debate ganhasse fôlego logo cedo.`;
    }
    if (index === 1) {
      return `Mais tarde, na apuração dos bastidores, ${sample.name} não deixou barato e rebateu com: “${textSnippet}”. O comentário jogou mais lenha na fogueira e garantiu que ninguém mudasse de assunto tão cedo.`;
    }
    return `Para fechar o apanhado das investigações, ${sample.name} arrematou pontuando: “${textSnippet}”. A observação selou o expediente e deixou evidente que o bom senso tirou folga da redação.`;
  });

  return narratives.join('\n\n');
}

function getCommentatorLeadIn(mood, commentator) {
  const cName = commentator?.name || 'nosso especialista';
  const leads = {
    zoeiro: `Para colocar uma lupa sobre esse espetáculo de zoeira e medir a vergonha alheia coletiva, a redação intimou ${cName} para a análise técnica:`,
    movimentado: `Diante do ritmo frenético e da sequência interminável de mensagens no chat, passamos a palavra para ${cName} auditar o tumulto:`,
    conversado: `Para dar um parecer sem meias-palavras sobre os rumos dessa prosa de boteco, ouvimos ${cName}:`,
    silencioso: `Nem mesmo o silêncio absoluto escapou do crivo da redação, que convocou ${cName} para avaliar o marasmo do dia:`,
  };
  return leads[mood] || leads.conversado;
}

function fallbackForeshadow(conversation) {
  const foreshadows = {
    zoeiro: 'A redação adverte: amanhã a conta da zoeira deve chegar, provavelmente em forma de print esquecido ou vingança no primeiro assunto do dia.',
    movimentado: 'Amanhã saberemos se o fôlego continua ou se o cansaço mental vai cobrar seu preço logo pela manhã. A recomendação da casa é tomar café reforçado.',
    conversado: 'Amanhã tem mais capítulo, desde que alguém apareça com uma versão diferente da mesma história para reabrir a discussão.',
    silencioso: 'Amanhã a gente tenta de novo. Com menos paz e mais vontade de tumultuar, se possível.',
  };
  return foreshadows[conversation.mood] || foreshadows.conversado;
}

function quietEdition(dayLabel, commentator = null) {
  const commentatorNote = commentator
    ? `\n\n🗣️ *PARECER DO ESPECIALISTA (${commentator.name.toUpperCase()}):*\n“Até eu cochilei na redação hoje. Ninguém brigou, ninguém passou vergonha... que dia patético! ${commentator.catchphrase || ''}”`
    : '';

  return [
    '📰 *THE GROUP TIMES*',
    dayLabel,
    '',
    '*Plantão do Silêncio*',
    'O grupo passou o dia em modo economia de palavras. A redação investigou a fundo e concluiu: ninguém reuniu fofoca com densidade suficiente para justificar a abertura dos trabalhos investigativos.',
    commentatorNote,
    '',
    '_Amanhã a gente tenta de novo. Com menos paz e mais assunto, por favor._',
  ]
    .filter(Boolean)
    .join('\n');
}

export function renderEdition(
  conversation,
  llmBits,
  { dayLabel = '', commentator = null, commentatorService = null, maxChars = Infinity } = {}
) {
  if (conversation?.quiet) return quietEdition(dayLabel, commentator);

  const safeConversation = {
    mood: conversation?.mood || 'conversado',
    timeline: Array.isArray(conversation?.timeline) ? conversation.timeline : [],
    quotes: Array.isArray(conversation?.quotes) ? conversation.quotes : [],
    totalMessageCount: Number(conversation?.totalMessageCount) || 0,
  };

  if (!safeConversation.timeline.length && conversation?.society?.despedidas) {
    const top = conversation.society.topFarewellUsers?.[0];
    const who = top ? String(top.jid || '').split('@')[0] : 'alguém';
    return [
      '📰 *THE GROUP TIMES*',
      dayLabel,
      '',
      '*Plantão Social: Cerimônia de Despedidas*',
      `O expediente registrou nada menos que ${conversation.society.despedidas} despedidas solenes. ${who} levou o protocolo tão a sério que parecia encerramento de ano letivo.`,
      '',
      '_A redação deseja boa sorte e paciência a quem insiste em dizer tchau sem ir embora de verdade._',
    ].join('\n');
  }

  const headline = llmBits?.capa ? cleanParagraph(llmBits.capa) : fallbackHeadline(safeConversation);

  const introRaw = llmBits?.intro || llmBits?.manchetes;
  const intro = introRaw ? cleanParagraph(introRaw) : fallbackIntro(safeConversation);

  // Bloco opinativo do comentarista residente
  let commentatorBlock = '';
  if (llmBits?.comentarista) {
    const cName = commentator?.name || 'Comentarista Residente';
    const cTitle = commentator?.title ? ` — ${commentator.title}` : '';
    commentatorBlock = `🗣️ *PARECER DO ESPECIALISTA (${cName.toUpperCase()}${cTitle.toUpperCase()}):*\n“${cleanParagraph(llmBits.comentarista)}”`;
  } else if (commentatorService?.renderCommentatorFallback && commentator) {
    commentatorBlock = commentatorService.renderCommentatorFallback(commentator, safeConversation).formatted;
  } else if (commentator?.name) {
    const catchphrase = commentator.catchphrase ? ` ${commentator.catchphrase}` : '';
    commentatorBlock = `🗣️ *PARECER DO ESPECIALISTA (${commentator.name.toUpperCase()}):*\n“Analisei os fatos de hoje e afirmo com convicção: a vergonha alheia foi além da conta.${catchphrase}”`;
  }

  const detalhesRaw = llmBits?.detalhes;
  const detalhes = detalhesRaw ? cleanParagraph(detalhesRaw) : fallbackDetails(safeConversation);

  // Frases literais autorizadas para arquivo (deduplicadas e limitadas a no máximo 2)
  const rawQuotes = llmBits?.citacoes
    ? String(llmBits.citacoes)
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
    : safeConversation.quotes.map((quote) => `${quote.name}: “${quote.text}”`);

  const seenQuotes = new Set();
  const quotesList = [];
  for (const q of rawQuotes) {
    const clean = q.replace(/^[•-]\s*/, '').trim();
    const key = clean.toLowerCase();
    if (!clean || seenQuotes.has(key)) continue;
    seenQuotes.add(key);
    quotesList.push(clean);
    if (quotesList.length >= 3) break;
  }

  const foreshadowRaw = llmBits?.foreshadow || llmBits?.fecho;
  const foreshadow = foreshadowRaw ? cleanParagraph(foreshadowRaw) : fallbackForeshadow(safeConversation);

  const sections = [
    '📰 *THE GROUP TIMES*',
    dayLabel,
    '',
    `*${headline}*`,
    '',
    intro,
  ];

  if (commentatorBlock) {
    const leadIn = getCommentatorLeadIn(safeConversation.mood, commentator);
    sections.push('', leadIn, '', commentatorBlock);
  }

  if (detalhes) {
    sections.push('', detalhes);
  }

  if (quotesList.length) {
    sections.push('', '*FRASES PARA O ARQUIVO*', ...quotesList.map((q) => `• ${q}`));
  }

  if (foreshadow) {
    sections.push('', `_${foreshadow}_`);
  }

  const fullText = sections.join('\n').trim();
  if (Number.isFinite(maxChars) && maxChars > 0 && fullText.length > maxChars) {
    const excess = fullText.length - maxChars;
    const trimmedDetalhes = detalhes.length > excess + 80
      ? cleanParagraph(detalhes.slice(0, Math.max(80, detalhes.length - excess - 20))) + '…'
      : detalhes;

    const resections = [
      '📰 *THE GROUP TIMES*',
      dayLabel,
      '',
      `*${headline}*`,
      '',
      intro,
    ];

    if (commentatorBlock) {
      const leadIn = getCommentatorLeadIn(safeConversation.mood, commentator);
      resections.push('', leadIn, '', commentatorBlock);
    }

    if (trimmedDetalhes) {
      resections.push('', trimmedDetalhes);
    }

    if (quotesList.length) {
      resections.push('', '*FRASES PARA O ARQUIVO*', ...quotesList.map((q) => `• ${q}`));
    }

    if (foreshadow) {
      resections.push('', `_${foreshadow}_`);
    }

    return resections.join('\n').trim();
  }

  return fullText;
}
