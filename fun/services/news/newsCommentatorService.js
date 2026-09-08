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
  function resolveCommentator(scopeKey, { now = Date.now() } = {}) {
    const s = String(scopeKey || '').trim();
    if (!s) return pickCommentatorArchetype(random);

    const existing = newsRepository?.getCommentator?.(s);
    if (existing?.name) {
      if (!existing.voiceName) {
        const match = COMMENTATOR_ARCHETYPES.find((a) => a.name.toLowerCase() === existing.name.toLowerCase());
        existing.voiceName = match?.voiceName || 'Zephyr';
        existing.voiceTone = match?.voiceTone || 'Sarcastic, comedic and expressive';
      }
      return existing;
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

    const saved = newsRepository?.saveCommentator?.(s, archetype, now);
    return saved || archetype;
  }

  /**
   * Gera parecer opinativo do comentarista para o fallback determinístico
   * ou para complementar edições quando o LLM não fornecer o bloco específico.
   */
  function renderCommentatorFallback(commentator, conversation) {
    const c = commentator || pickCommentatorArchetype(random);
    const mood = conversation?.mood || 'conversado';
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
  };
}
