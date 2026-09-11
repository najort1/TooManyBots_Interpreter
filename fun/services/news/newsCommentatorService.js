/**
 * Serviço de Comentarista Residente do Jornal Diário (The Group Times).
 *
 * Responsável por:
 * - Recuperar a persona do comentarista persistida para o grupo (garantindo consistência entre edições).
 * - Inicializar e persistir uma persona carismática caso o grupo ainda não tenha uma.
 * - Enriquecer a voz do comentarista com o vocabulário real e gírias do grupo (via personaStyleDeriver / groupMemoryService).
 * - Fornecer pareceres e ganchos opinativos para a narrativa editorial e para os fallbacks determinísticos.
 */

const COMMENTATOR_ARCHETYPES = [
  {
    name: 'Cachorro Chupetinha',
    title: 'comentarista canino residente e fiscal de vergonha alheia',
    personality: 'latidos de desconfiança, ceticismo com a inteligência humana, acha todo mundo emocionado e ri de qualquer mico',
    catchphrase: 'Au au au, essa vergonha eu não passo nem de coleira!',
    style: 'sarcástico, canino e debochado',
    voiceName: 'Zephyr',
    voiceTone: 'Vocal Smile, high pitched, cynical, playful and sarcastic bark tone',
  },
  {
    name: 'Fiscal do Rolo',
    title: 'auditor sênior de tretas e picaretagens do grupo',
    personality: 'fareja golpe em qualquer conversa amigável, desconfia até de bom dia e acha que tudo termina em golpe ou esquema',
    catchphrase: 'Aqui tem maracutaia, eu sinto o cheiro de longe!',
    style: 'ácido, investigativo e desconfiado',
    voiceName: 'Charon',
    voiceTone: 'Deep, rapid-fire, suspicious, gritty and investigative',
  },
  {
    name: 'Craque Neto do Zap',
    title: 'comentarista indignado de plantão',
    personality: 'indignação teatral, gritaria sincera, acha que falta raça na redação e cobra atitude dos envolvidos',
    catchphrase: 'É uma barbaridade! Cês tão de sacanagem com a minha cara!',
    style: 'enfático, explosivo e histriônico',
    voiceName: 'Fenrir',
    voiceTone: 'Loud, explosive, passionate, outraged and hysterical',
  },
  {
    name: 'Tia da Coxinha',
    title: 'cronista de fuxicos e conselheira duvidosa',
    personality: 'voz mansa, veneno puro nos bastidores, adora um disse-me-disse e finge preocupação com os vacilos alheios',
    catchphrase: 'Não é por falar mal, mas eu avisei que isso não ia prestar...',
    style: 'fofoqueiro, irônico e sorrateiro',
    voiceName: 'Aoede',
    voiceTone: 'Sweet gossip tone, passive-aggressive, conversational and dramatic',
  },
  {
    name: 'Gato Rebaixado',
    title: 'filósofo niilista do grupo',
    personality: 'preguiça cósmica, olha de cima para os mortais, acha o drama do dia uma perda patética de energia',
    catchphrase: 'Miau... tanto esforço pra passar essa vergonha no crédito.',
    style: 'blasé, irônico e desinteressado',
    voiceName: 'Puck',
    voiceTone: 'Lethargic, bored, ironic, slow and dismissive',
  },
  {
    name: 'Doutor Fuxico',
    title: 'psicanalista de boteco e perito em intrigas',
    personality: 'dá diagnósticos absurdos com jargão pomposo para explicar as maiores infantilidades do chat',
    catchphrase: 'O quadro clínico é grave: síndrome de falta de lote pra capinar.',
    style: 'pseudointelectual, zombeteiro e assertivo',
    voiceName: 'Kore',
    voiceTone: 'Pompous, theatrical, pseudo-intellectual, articulate and judgmental',
  },
];

export function pickCommentatorArchetype(random = Math.random) {
  const index = Math.floor(random() * COMMENTATOR_ARCHETYPES.length);
  return { ...COMMENTATOR_ARCHETYPES[index] || COMMENTATOR_ARCHETYPES[0] };
}

/**
 * Modula a atuação e o tom do comentarista de acordo com o clima (mood) do grupo,
 * preservando estritamente a voz-base (voiceName) que identifica o personagem.
 */
export function deriveCommentatorMoodProfile(commentator, mood = 'conversado') {
  const base = commentator || pickCommentatorArchetype();
  const safeMood = String(mood || 'conversado').toLowerCase();

  const moodModifiers = {
    zoeiro: {
      styleNote: 'em clima de deboche total, rindo dos micos e tirando sarro',
      toneModifier: 'giggling, amused, highly sarcastic, mocking tone with light chuckles',
      actingTone: 'debochado e gargalhando',
      leadInPrefix: 'Para colocar a lupa nesse espetáculo de zoeira e medir a vergonha alheia coletiva, a redação intimou',
    },
    movimentado: {
      styleNote: 'em ritmo elétrico, apressado e cobrando postura dos envolvidos',
      toneModifier: 'fast-paced, breathless, urgent, agitated, expressive and theatrical',
      actingTone: 'agitado e histriônico',
      leadInPrefix: 'Diante da avalanche frenética de mensagens e do caos instaurado no chat, passamos a palavra para',
    },
    conversado: {
      styleNote: 'em tom descontraído de mesa de boteco, comentando a fofoca sem pressa',
      toneModifier: 'relaxed, conversational, smooth, slow-tempo, ironic and casual',
      actingTone: 'relaxado e irônico',
      leadInPrefix: 'Para dar aquele parecer sem meias-palavras sobre os rumos dessa prosa de boteco, ouvimos',
    },
    silencioso: {
      styleNote: 'bocejando de tédio, indignado com a falta de assunto e cobrando agitação',
      toneModifier: 'lethargic, yawning, annoyed by inactivity, dry, bored and deadpan',
      actingTone: 'indignado com o marasmo',
      leadInPrefix: 'Nem mesmo o silêncio absoluto escapou da auditoria da redação, que convocou',
    },
  };

  const modifier = moodModifiers[safeMood] || moodModifiers.conversado;
  const baseTone = base.voiceTone || 'Sarcastic, comedic, lively and expressive';
  const baseStyle = base.style || 'sarcástico e debochado';

  return {
    ...base,
    mood: safeMood,
    actingTone: modifier.actingTone,
    leadInPrefix: modifier.leadInPrefix,
    style: `${baseStyle} (${modifier.styleNote})`,
    voiceTone: `${baseTone}, ${modifier.toneModifier}`,
    voiceName: base.voiceName || 'Zephyr',
  };
}

export function createNewsCommentatorService({
  newsRepository = null,
  personaService = null,
  groupMemoryService = null,
  socialMemoryService = null,
  random = Math.random,
} = {}) {
  /**
   * Obtém ou inicializa a persona do comentarista consistente para o grupo.
   */
  function resolveCommentator(scopeKey, { now = Date.now(), mood = null } = {}) {
    const s = String(scopeKey || '').trim();
    if (!s) {
      const fresh = pickCommentatorArchetype(random);
      return mood ? deriveCommentatorMoodProfile(fresh, mood) : fresh;
    }

    const existing = newsRepository?.getCommentator?.(s);
    if (existing?.name) {
      let needsSave = false;
      if (!existing.voiceName || !existing.voiceTone) {
        const match = COMMENTATOR_ARCHETYPES.find((a) => a.name.toLowerCase() === existing.name.toLowerCase());
        existing.voiceName = existing.voiceName || match?.voiceName || 'Zephyr';
        existing.voiceTone = existing.voiceTone || match?.voiceTone || 'Sarcastic, comedic and expressive';
        needsSave = true;
      }
      if (needsSave) {
        newsRepository?.saveCommentator?.(s, existing, now);
      }
      return mood ? deriveCommentatorMoodProfile(existing, mood) : existing;
    }

    // Cria nova persona persistente
    const archetype = pickCommentatorArchetype(random);

    // Enriquecimento opcional com estilo ou lore do grupo
    try {
      const styleBlock = personaService?.buildStyleBlock?.(s);
      if (styleBlock && !archetype.style.includes('vocabulário')) {
        archetype.style = `${archetype.style} (sintonizado com as gírias locais)`;
      }
    } catch {
      // tolerância a falha na leitura de estilo
    }

    const saved = newsRepository?.saveCommentator?.(s, archetype, now) || archetype;
    return mood ? deriveCommentatorMoodProfile(saved, mood) : saved;
  }

  /**
   * Gera parecer opinativo do comentarista para o fallback determinístico
   * ou para complementar edições quando o LLM não fornecer o bloco específico.
   */
  function renderCommentatorFallback(commentator, conversation) {
    const mood = conversation?.mood || 'conversado';
    const c = deriveCommentatorMoodProfile(commentator, mood);
    const topParticipant = conversation?.timeline?.[0]?.participants?.[0] || 'o pessoal';

    const observations = {
      zoeiro: `Olha, eu vejo ${topParticipant} rindo de tudo e só consigo pensar: ninguém ali trabalha? ${c.catchphrase}`,
      movimentado: `Parecia bolsa de valores em dia de crise. Uma gritaria danada pra não chegarem a conclusão nenhuma! ${c.catchphrase}`,
      conversado: `Gastaram teclado o dia inteiro pra falar de amenidades. Meu parecer técnico? Nota dois pela audácia. ${c.catchphrase}`,
      silencioso: `Nem grilo cantou hoje. Povo sumiu, provavelmente com vergonha acumulada de ontem. ${c.catchphrase}`,
    };

    const text = observations[mood] || observations.conversado;
    return {
      name: c.name,
      title: c.title,
      text,
      formatted: `🗣️ *PARECER DO ESPECIALISTA (${c.name.toUpperCase()} — ${c.title.toUpperCase()}):*\n“${text}”`,
    };
  }

  return {
    resolveCommentator,
    renderCommentatorFallback,
    pickCommentatorArchetype,
    deriveCommentatorMoodProfile,
  };
}
