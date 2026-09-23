/**
 * Módulo de Roteirização e Síntese de Áudio do Jornal The Group Times.
 *
 * Transforma a edição diária em um programa de rádio/podcast encenado por
 * múltiplas vozes do Gemini TTS:
 * - Speaker 1: Âncora / repórter investigativo opinativo e sarcástico
 * - Speaker 2: Comentarista residente do grupo (ex: Cachorro Chupetinha, Fiscal do Rolo)
 */

import { formatMultiSpeakerPrompt, GEMINI_TTS_VOICES } from '../geminiTtsService.js';
import { deriveCommentatorMoodProfile } from './newsCommentatorService.js';

function stripWhatsAppFormatting(text) {
  return String(text || '')
    .replace(/[*_~`]/g, '')
    .replace(/•\s*/g, '')
    .replace(/^[-–—]\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Garante que a frase termine com pontuação final adequada (. ! ?),
 * respeitando dois-pontos (:) em transições de fala sem criar "..", ":." ou duplicações.
 */
export function ensureSentencePunctuation(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return '';
  return /[:.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/**
 * Junta múltiplas frases/partes em um parágrafo falado limpo,
 * garantindo pontuação gramatical fechada e impedindo duplicações como "..", ":.", "...", "?." etc.
 */
export function joinSentences(...parts) {
  return parts
    .map((p) => ensureSentencePunctuation(stripWhatsAppFormatting(p)))
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .replace(/:\./g, ':')
    .replace(/:\s*\./g, ':')
    .replace(/\.{2,}/g, '.')
    .replace(/([?!])\./g, '$1')
    .trim();
}

/**
 * Limpa o texto da fala do comentarista vindo do LLM,
 * removendo prefixos de diálogo (ex: "Fiscal do Rolo: ") e aspas envolventes,
 * garantindo que a fala soe natural em primeira pessoa no rádio.
 */
export function cleanCommentatorSpeech(text) {
  let cleaned = stripWhatsAppFormatting(text);
  if (!cleaned) return '';

  // Se o LLM gerou formato narrativo "Fulano disparou: \"...\"", extrai a citação
  const quoteMatch = cleaned.match(/(?:disparou|afirmou|declarou|disse|soltou|opinou):\s*["“](.+?)["”]/i);
  if (quoteMatch) {
    cleaned = quoteMatch[1].trim();
  } else {
    // Remove prefixo de diálogo no início (ex: "Nome: " ou "Comentarista: " ou "Âncora: ")
    cleaned = cleaned.replace(/^[^:\n]{1,45}:\s*/i, '');
    // Remove aspas envolventes
    cleaned = cleaned.replace(/^["“'«](.+)["”'»]$/s, '$1').trim();
  }

  return ensureSentencePunctuation(cleaned);
}

/**
 * Trunca texto para fala respeitando estritamente o fechamento de sentenças completas.
 * NUNCA insere reticências no meio de falas e NUNCA corta palavras ao meio,
 * prevenindo engasgos, estalos e picotamento no Gemini TTS.
 * Quando maxChars não é fornecido ou é infinito/nulo, preserva o texto integral sem truncamento.
 */
export function truncateForSpeech(text, maxChars = Infinity) {
  const clean = stripWhatsAppFormatting(text);
  if (!clean) return '';
  if (!Number.isFinite(maxChars) || maxChars <= 0 || clean.length <= maxChars) {
    return ensureSentencePunctuation(clean);
  }

  // Divide por limites de frase (. ! ?)
  const sentences = clean.match(/[^.!?]+(?:[.!?]+|$)/g) || [clean];
  const selected = [];
  let currentLen = 0;

  for (const rawSentence of sentences) {
    const sentence = rawSentence.trim();
    if (!sentence) continue;
    const punctSentence = ensureSentencePunctuation(sentence);
    const addedLen = selected.length ? 1 + punctSentence.length : punctSentence.length;
    if (currentLen + addedLen <= maxChars) {
      selected.push(punctSentence);
      currentLen += addedLen;
    } else {
      break;
    }
  }

  // Se conseguimos selecionar pelo menos 1 frase completa, retorna!
  if (selected.length > 0) {
    return selected.join(' ');
  }

  // Se a primeira frase é só um pouco maior que maxChars (tolerância de até 25% ou 25 caracteres),
  // mantém a frase inteira para não mutilar o sentido nem deixar palavras soltas pelo meio!
  const first = ensureSentencePunctuation(sentences[0].trim());
  if (first.length <= maxChars * 1.25 || first.length - maxChars <= 25) {
    return first;
  }

  // Se for uma frase realmente longa, quebra em uma oração coordenada/subordinada natural com sentido
  const sliced = first.slice(0, maxChars);
  const lastClause = Math.max(
    sliced.lastIndexOf(', '),
    sliced.lastIndexOf('; '),
    sliced.lastIndexOf(' - ')
  );
  if (lastClause > Math.floor(maxChars * 0.45)) {
    return `${sliced.slice(0, lastClause).trim()}.`;
  }

  const lastSpace = sliced.lastIndexOf(' ');
  if (lastSpace > Math.floor(maxChars * 0.35)) {
    return `${sliced.slice(0, lastSpace).trim()}.`;
  }

  return `${sliced.trim()}.`;
}

/**
 * Apara a introdução do âncora preservando SEMPRE a saudação, a manchete e o gancho do comentarista.
 */
function trimAnchorIntro(text, targetLen) {
  const hookMatch = text.match(/(Para (?:analisar|avaliar)[^?!]+[?!].*)$/i);
  if (!hookMatch) {
    return truncateForSpeech(text, targetLen);
  }

  const hook = hookMatch[1].trim();
  const intro = text.slice(0, hookMatch.index).trim();
  const availableForIntro = Math.max(60, targetLen - hook.length - 1);

  // Se tem "Na manchete de hoje:", preserva o prefixo e apara a manchete
  const mancheteMatch = intro.match(/^(.*?(?:Na manchete de hoje:\s*))(.+)$/i);
  if (mancheteMatch) {
    const prefix = mancheteMatch[1].trim();
    const rawHeadline = mancheteMatch[2].trim();
    const headlineBudget = Math.max(30, availableForIntro - prefix.length - 1);
    const trimmedHeadline = truncateForSpeech(rawHeadline, headlineBudget);
    return joinSentences(prefix, trimmedHeadline, hook);
  }

  const trimmedIntro = truncateForSpeech(intro, availableForIntro);
  return joinSentences(trimmedIntro, hook);
}

/**
 * Garante que o total de caracteres falados de todos os turnos não ultrapasse um teto opcional.
 * Quando maxChars <= 0 ou não informado, não impõe nenhum limite de caracteres.
 * Aplica redução priorizando partes secundárias (detalhes/bastidores),
 * protegendo rigorosamente a convocação do comentarista pelo âncora e a despedida final.
 */
export function enforceAudioScriptCap(turns, maxChars = 0) {
  if (!Array.isArray(turns) || !turns.length) return turns;
  const limit = Number(maxChars) || 0;
  if (limit <= 0 || !Number.isFinite(limit)) return turns;
  let total = turns.reduce((acc, t) => acc + (t?.text?.length || 0), 0);
  if (total <= limit) return turns;

  // Prioridade de redução jornalística:
  // 1. Turno 2 (detalhes e bastidores secundários — parte mais descartável)
  // 2. Turno 1 (declaração longa do comentarista — reduz a frases centrais)
  // 3. Turno 0 (intro/manchete do âncora — preserva gancho e manchete essenciais)
  // 4. Demais turnos existentes
  const priorityOrder = [2, 1, 0];
  const allIndices = [
    ...priorityOrder.filter((i) => i < turns.length),
    ...turns.map((_, i) => i).filter((i) => !priorityOrder.includes(i)),
  ];

  for (const index of allIndices) {
    if (total <= limit) break;
    const turn = turns[index];
    if (!turn?.text) continue;

    const excess = total - limit;
    if (index === 0 && /(Para (?:analisar|avaliar)[^?!]+[?!].*)$/i.test(turn.text)) {
      if (turn.text.length <= 140) continue;
      const targetLen = Math.max(130, turn.text.length - excess);
      if (targetLen < turn.text.length) {
        const prevLen = turn.text.length;
        turn.text = trimAnchorIntro(turn.text, targetLen);
        total -= (prevLen - turn.text.length);
      }
    } else {
      if (turn.text.length <= 80) continue;
      const targetLen = Math.max(70, turn.text.length - excess);
      if (targetLen < turn.text.length) {
        const prevLen = turn.text.length;
        turn.text = truncateForSpeech(turn.text, targetLen);
        total -= (prevLen - turn.text.length);
      }
    }
  }

  // Passagem de segurança estrita caso ainda ultrapasse o limite
  if (total > limit) {
    for (const turn of turns) {
      if (total <= limit) break;
      if (turn?.text && turn.text.length > 50) {
        const excess = total - limit;
        const targetLen = Math.max(40, turn.text.length - excess);
        const prevLen = turn.text.length;
        turn.text = truncateForSpeech(turn.text, targetLen);
        total -= (prevLen - turn.text.length);
      }
    }
  }

  return turns;
}

/**
 * Constrói o roteiro multi-voz (Âncora + Comentarista) formatado com perfis e direções cênicas.
 * Modula a interpretação dramática e o ritmo do comentarista de acordo com o clima (mood) do grupo,
 * preservando estritamente a voz-base (voiceName) que identifica o personagem.
 */
export function buildNewsAudioTranscript({
  edition = {},
  commentator = null,
  conversation = {},
  funConfig = {},
} = {}) {
  const anchorVoice = String(funConfig?.groupNewsAnchorVoice || GEMINI_TTS_VOICES.PUCK);
  const mood = conversation?.mood || 'conversado';
  const cMod = deriveCommentatorMoodProfile(commentator, mood);

  const commentatorVoice = String(
    cMod.voiceName || funConfig?.groupNewsCommentatorVoice || GEMINI_TTS_VOICES.ZEPHYR
  );
  const commentatorName = cMod.name || 'Comentarista';
  const commentatorTitle = cMod.title || 'analista de bastidores';
  const commentatorStyle = cMod.style || 'sarcástico e debochado';
  const commentatorTone = cMod.voiceTone || 'Cynical, comedic, lively and expressive';
  const commentatorActingTone = cMod.actingTone || 'incisivo e debochado';

  const audioProfile = {
    'Speaker 1': 'An authoritative, sarcastic, rapid-fire investigative news anchor presenting the late-night edition of The Group Times.',
    'Speaker 2': `${commentatorName}, ${commentatorTitle}. Personality: ${commentatorTone}.`,
  };

  const directorNote = {
    'Speaker 1': 'Style: Sarcastic Newscaster. Pace: Dynamic, witty, energetic. Language: Brazilian Portuguese.',
    'Speaker 2': `Style: ${commentatorStyle}. Pace: Expressive, comedic, opinionated. Language: Brazilian Portuguese.`,
  };

  const scene = 'A lively radio news studio at 23:59, where the main anchor and the resident comedic commentator argue about the group\'s daily shenanigans.';
  const sampleContext = 'Humorous satirical late-night radio podcast in Brazilian Portuguese, with natural banter, irony and playful timing.';

  const turns = [];

  if (conversation?.quiet) {
    const catchphrase = cMod.catchphrase ? ` ${stripWhatsAppFormatting(cMod.catchphrase)}` : '';
    turns.push({
      speaker: 'Speaker 1',
      tone: 'sarcástico e desanimado',
      text: `Boa noite, ouvintes do The Group Times! Plantão do Silêncio na edição das 23:59. Nossos repórteres reviraram o chat de ponta a ponta e a conclusão é trágica: absolutamente ninguém rendeu assunto hoje. Passo a bola pro nosso especialista de plantão, ${commentatorName}! O que você tem a dizer sobre esse marasmo?`,
    });
    turns.push({
      speaker: 'Speaker 2',
      tone: commentatorActingTone,
      text: joinSentences(
        'Mas que decadência! Até eu cochilei na redação hoje! Ninguém brigou, ninguém passou vergonha... que dia patético!',
        catchphrase
      ),
    });
    turns.push({
      speaker: 'Speaker 1',
      tone: 'fechamento bem-humorado',
      text: 'Pois é. Amanhã a gente volta torcendo por menos paz e mais vontade de tumultuar. Boa noite a todos e até amanhã!',
    });
  } else {
    const rawCapa = edition.capa || 'As confusões do dia pararam a redação';
    const capa = ensureSentencePunctuation(stripWhatsAppFormatting(rawCapa));

    const rawIntro = edition.intro || edition.manchetes || '';
    const intro = rawIntro ? ensureSentencePunctuation(stripWhatsAppFormatting(rawIntro)) : '';

    const rawParecer = cleanCommentatorSpeech(
      edition.comentarista || cMod.catchphrase || 'Eu acompanhei tudo de perto e digo: a vergonha alheia passou do limite.'
    );
    const parecer = ensureSentencePunctuation(rawParecer);

    const rawDetalhes = edition.detalhes || 'Nos bastidores, as conversas cruzadas não chegaram a consenso nenhum.';
    const detalhes = ensureSentencePunctuation(stripWhatsAppFormatting(rawDetalhes));

    let citacaoAudio = '';
    if (edition.citacoes) {
      const quotes = String(edition.citacoes)
        .split('\n')
        .map((l) => stripWhatsAppFormatting(l))
        .filter(Boolean);
      if (quotes.length) {
        citacaoAudio = `E pra registrar no arquivo da redação: ${quotes.join('. ')}`;
      }
    }

    const rawFecho = edition.foreshadow || edition.fecho || 'Amanhã tem mais capítulo e a conta dessa zoeira deve chegar.';
    const fecho = ensureSentencePunctuation(stripWhatsAppFormatting(rawFecho));

    const commentatorLead = commentatorName
      ? `Para analisar o tamanho dessa loucura, chamo nosso comentarista residente, ${commentatorName}! Fala pra gente, o que você achou dessa história?`
      : 'Para avaliar a situação, acionamos nossa bancada de comentários! Fala pra gente, o que você achou dessa história?';

    turns.push({
      speaker: 'Speaker 1',
      tone: 'entusiasmado e jornalístico',
      text: joinSentences(
        'Atenção, ouvintes! No ar a edição do The Group Times!',
        `Na manchete de hoje: ${capa}`,
        intro,
        commentatorLead
      ),
    });

    turns.push({
      speaker: 'Speaker 2',
      tone: commentatorActingTone,
      text: joinSentences('Olha, ouvindo tudo isso eu só digo uma coisa:', parecer),
    });

    turns.push({
      speaker: 'Speaker 1',
      tone: 'investigativo e irônico',
      text: joinSentences('E tem mais apuração nos bastidores:', detalhes, citacaoAudio, fecho),
    });

    if (cMod.catchphrase) {
      turns.push({
        speaker: 'Speaker 2',
        tone: 'enfático com bordão',
        text: joinSentences(
          'É exatamente por isso que eu sempre afirmo:',
          cleanCommentatorSpeech(cMod.catchphrase)
        ),
      });
    }

    turns.push({
      speaker: 'Speaker 1',
      tone: 'fechamento dramático',
      text: 'A redação do The Group Times se despede por hoje. Boa noite e cuidem de suas reputações!',
    });
  }

  const cappedTurns = funConfig?.groupNewsAudioMaxChars > 0
    ? enforceAudioScriptCap(turns, funConfig.groupNewsAudioMaxChars)
    : turns;

  const prompt = formatMultiSpeakerPrompt({
    audioProfile,
    directorNote,
    scene,
    sampleContext,
    transcript: cappedTurns,
  });

  return {
    prompt,
    turns: cappedTurns,
    speakers: [
      { speaker: 'Speaker 1', voiceName: anchorVoice },
      { speaker: 'Speaker 2', voiceName: commentatorVoice },
    ],
    anchorVoice,
    commentatorVoice,
    commentatorName,
  };
}

/**
 * Helper com backoff simples para uso assíncrono.
 */
function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Executa a síntese de áudio multi-voz para a edição fornecida com até 3 tentativas.
 */
export async function synthesizeNewsAudio({
  edition = {},
  commentator = null,
  conversation = {},
  ttsService = null,
  funConfig = {},
  logger = null,
  maxAttempts = 3,
  delays = [500, 1000, 2000],
  sleepFn = defaultSleep,
} = {}) {
  if (!ttsService || typeof ttsService.synthesize !== 'function') {
    return { ok: false, reason: 'missing-tts-service' };
  }
  if (!ttsService.isAvailable()) {
    return { ok: false, reason: 'tts-unavailable' };
  }
  if (funConfig.groupNewsAudioEnabled === false) {
    return { ok: false, reason: 'audio-news-disabled' };
  }

  let transcriptData;
  try {
    transcriptData = buildNewsAudioTranscript({
      edition,
      commentator,
      conversation,
      funConfig,
    });
  } catch (err) {
    logger?.warn?.('[newsAudio] erro ao montar transcript: %s', String(err?.message || err));
    return { ok: false, reason: 'transcript-build-failed' };
  }

  const model = funConfig.groupNewsAudioModel || 'gemini-3.1-flash-tts-preview';
  const temperature = Number.isFinite(Number(funConfig.groupNewsAudioTemperature))
    ? Number(funConfig.groupNewsAudioTemperature)
    : 1;
  const timeoutMs = Number.isFinite(Number(funConfig.groupNewsAudioTimeoutMs)) && Number(funConfig.groupNewsAudioTimeoutMs) > 0
    ? Number(funConfig.groupNewsAudioTimeoutMs)
    : 90_000;

  const attemptsTotal = Math.max(1, Math.floor(Number(maxAttempts) || 3));
  let lastFailure = null;

  for (let attempt = 1; attempt <= attemptsTotal; attempt += 1) {
    try {
      const result = await ttsService.synthesize(transcriptData.prompt, {
        voices: transcriptData.speakers,
        model,
        temperature,
        timeoutMs,
      });

      if (result?.ok && result?.buffer) {
        return {
          ok: true,
          buffer: result.buffer,
          mimeType: result.mimeType || 'audio/ogg; codecs=opus',
          transcriptData,
          attempts: attempt,
        };
      }

      lastFailure = { ok: false, reason: result?.reason || 'synthesis-failed' };
      logger?.warn?.(
        '[newsAudio] tentativa %d/%d de síntese falhou: %s',
        attempt,
        attemptsTotal,
        lastFailure.reason
      );
    } catch (error) {
      lastFailure = { ok: false, reason: error?.message || 'generation-error' };
      logger?.warn?.(
        '[newsAudio] tentativa %d/%d erro na síntese: %s',
        attempt,
        attemptsTotal,
        String(error?.message || error)
      );
    }

    if (attempt < attemptsTotal) {
      const delayMs = delays[attempt - 1] ?? 1000;
      if (delayMs > 0) {
        await sleepFn(delayMs);
      }
    }
  }

  return lastFailure || { ok: false, reason: 'generation-error' };
}

/**
 * Envia o áudio gerado no WhatsApp via socket com até 3 tentativas e backoff.
 */
export async function sendNewsAudioWithRetry(
  sock,
  scopeKey,
  { audioBuffer, audioMimeType },
  {
    maxAttempts = 3,
    delays = [500, 1000, 2000],
    sleepFn = defaultSleep,
    logger = console,
  } = {}
) {
  if (!audioBuffer || typeof sock?.sendMessage !== 'function') {
    return { ok: false, reason: 'missing-audio-or-socket' };
  }

  const attemptsTotal = Math.max(1, Math.floor(Number(maxAttempts) || 3));
  let lastError = null;

  for (let attempt = 1; attempt <= attemptsTotal; attempt += 1) {
    try {
      await sock.sendMessage(scopeKey, {
        audio: audioBuffer,
        mimetype: audioMimeType || 'audio/ogg; codecs=opus',
        ptt: true,
      });
      return { ok: true, attempts: attempt };
    } catch (err) {
      lastError = err;
      logger?.warn?.(
        `[fun/news] audio send attempt ${attempt}/${attemptsTotal} failed ${String(scopeKey).slice(0, 28)}: ${err?.message || err}`
      );
      if (attempt < attemptsTotal) {
        const delayMs = delays[attempt - 1] ?? 1000;
        if (delayMs > 0) {
          await sleepFn(delayMs);
        }
      }
    }
  }

  return { ok: false, reason: lastError?.message || 'audio-send-failed', error: lastError };
}
