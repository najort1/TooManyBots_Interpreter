/**
 * Módulo de Roteirização e Síntese de Áudio do Jornal The Group Times.
 *
 * Transforma a edição diária em um programa de rádio/podcast encenado por
 * múltiplas vozes do Gemini TTS:
 * - Speaker 1: Âncora / repórter investigativo opinativo e sarcástico
 * - Speaker 2: Comentarista residente do grupo (ex: Cachorro Chupetinha, Fiscal do Rolo)
 */

import { formatMultiSpeakerPrompt, GEMINI_TTS_VOICES } from '../geminiTtsService.js';

function stripWhatsAppFormatting(text) {
  return String(text || '')
    .replace(/[*_~`]/g, '')
    .replace(/•\s*/g, '')
    .replace(/^[-–—]\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncateForSpeech(text, maxChars = 280) {
  const clean = stripWhatsAppFormatting(text);
  if (clean.length <= maxChars) return clean;
  const sliced = clean.slice(0, maxChars);
  const lastDot = sliced.lastIndexOf('.');
  if (lastDot > 100) return sliced.slice(0, lastDot + 1);
  const lastComma = sliced.lastIndexOf(',');
  if (lastComma > 100) return `${sliced.slice(0, lastComma)}...`;
  return `${sliced.trim()}...`;
}

/**
 * Constrói o roteiro multi-voz (Âncora + Comentarista) formatado com perfis e direções cênicas.
 */
export function buildNewsAudioTranscript({
  edition = {},
  commentator = null,
  conversation = {},
  funConfig = {},
} = {}) {
  const anchorVoice = String(funConfig?.groupNewsAnchorVoice || GEMINI_TTS_VOICES.PUCK);
  const commentatorVoice = String(
    commentator?.voiceName || funConfig?.groupNewsCommentatorVoice || GEMINI_TTS_VOICES.ZEPHYR
  );
  const commentatorName = commentator?.name || 'Comentarista';
  const commentatorTitle = commentator?.title || 'analista de bastidores';
  const commentatorStyle = commentator?.style || 'sarcástico e debochado';
  const commentatorTone = commentator?.voiceTone || 'Cynical, comedic, lively and expressive';

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
    const catchphrase = commentator?.catchphrase ? ` ${stripWhatsAppFormatting(commentator.catchphrase)}` : '';
    turns.push({
      speaker: 'Speaker 1',
      tone: 'sarcástico e desanimado',
      text: 'Boa noite, ouvintes do The Group Times! Plantão do Silêncio na edição das 23:59. Nossos repórteres reviraram o chat de ponta a ponta e a conclusão é trágica: absolutamente ninguém rendeu assunto hoje.',
    });
    turns.push({
      speaker: 'Speaker 2',
      tone: 'indignado e bocejando',
      text: `Mas que decadência! Até eu cochilei na redação hoje! Ninguém brigou, ninguém passou vergonha... que dia patético!${catchphrase}`,
    });
    turns.push({
      speaker: 'Speaker 1',
      tone: 'fechamento bem-humorado',
      text: 'Pois é. Amanhã a gente volta torcendo por menos paz e mais vontade de tumultuar. Boa noite a todos e até amanhã!',
    });
  } else {
    const capa = truncateForSpeech(edition.capa || 'As confusões do dia pararam a redação', 140);
    const intro = truncateForSpeech(
      edition.intro || edition.manchetes || 'Os membros do grupo protagonizaram mais um capítulo de debates intermináveis.',
      240
    );
    const parecer = truncateForSpeech(
      edition.comentarista || commentator?.catchphrase || 'Eu acompanhei tudo de perto e digo: a vergonha alheia passou do limite.',
      220
    );
    const detalhes = truncateForSpeech(
      edition.detalhes || 'Nos bastidores, as conversas cruzadas não chegaram a consenso nenhum.',
      220
    );

    let citacaoAudio = '';
    if (edition.citacoes) {
      const firstQuote = stripWhatsAppFormatting(String(edition.citacoes).split('\n')[0] || '');
      if (firstQuote) {
        citacaoAudio = ` E pra registrar no arquivo: ${firstQuote}.`;
      }
    }

    const fecho = truncateForSpeech(
      edition.foreshadow || edition.fecho || 'Amanhã tem mais capítulo e a conta dessa zoeira deve chegar.',
      160
    );

    turns.push({
      speaker: 'Speaker 1',
      tone: 'entusiasmado e jornalístico',
      text: `Atenção, ouvintes! Está no ar a edição das 23:59 do The Group Times! Na manchete de hoje: ${capa}. ${intro}`,
    });

    turns.push({
      speaker: 'Speaker 2',
      tone: 'incisivo e debochado',
      text: `Olha, eu analisei minuciosamente esses acontecimentos e digo: ${parecer}`,
    });

    turns.push({
      speaker: 'Speaker 1',
      tone: 'investigativo e irônico',
      text: `E tem mais apuração nos bastidores: ${detalhes}.${citacaoAudio}`,
    });

    if (commentator?.catchphrase) {
      turns.push({
        speaker: 'Speaker 2',
        tone: 'enfático com bordão',
        text: `É exatamente por isso que eu sempre afirmo: ${stripWhatsAppFormatting(commentator.catchphrase)}`,
      });
    }

    turns.push({
      speaker: 'Speaker 1',
      tone: 'fechamento dramático',
      text: `É isso. ${fecho}. A redação do The Group Times se despede por hoje. Boa noite e cuidem de suas reputações!`,
    });
  }

  const prompt = formatMultiSpeakerPrompt({
    audioProfile,
    directorNote,
    scene,
    sampleContext,
    transcript: turns,
  });

  return {
    prompt,
    turns,
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
 * Executa a síntese de áudio multi-voz para a edição fornecida.
 */
export async function synthesizeNewsAudio({
  edition = {},
  commentator = null,
  conversation = {},
  ttsService = null,
  funConfig = {},
  logger = null,
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

  try {
    const transcriptData = buildNewsAudioTranscript({
      edition,
      commentator,
      conversation,
      funConfig,
    });

    const model = funConfig.groupNewsAudioModel || 'gemini-3.1-flash-tts-preview';
    const temperature = Number.isFinite(Number(funConfig.groupNewsAudioTemperature))
      ? Number(funConfig.groupNewsAudioTemperature)
      : 1;

    const result = await ttsService.synthesize(transcriptData.prompt, {
      voices: transcriptData.speakers,
      model,
      temperature,
    });

    if (!result?.ok || !result?.buffer) {
      return { ok: false, reason: result?.reason || 'synthesis-failed' };
    }

    return {
      ok: true,
      buffer: result.buffer,
      mimeType: result.mimeType || 'audio/ogg; codecs=opus',
      transcriptData,
    };
  } catch (error) {
    logger?.debug?.('[newsAudio] erro na geração do podcast do jornal: %s', String(error?.message || error));
    return { ok: false, reason: 'generation-error' };
  }
}
