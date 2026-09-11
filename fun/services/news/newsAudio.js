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

function truncateForSpeech(text, maxChars = 120) {
  const clean = stripWhatsAppFormatting(text);
  if (clean.length <= maxChars) return clean;
  const sliced = clean.slice(0, maxChars);
  const lastDot = Math.max(sliced.lastIndexOf('.'), sliced.lastIndexOf('!'), sliced.lastIndexOf('?'));
  if (lastDot > Math.floor(maxChars * 0.45)) return sliced.slice(0, lastDot + 1).trim();
  const lastComma = sliced.lastIndexOf(',');
  if (lastComma > Math.floor(maxChars * 0.45)) return `${sliced.slice(0, lastComma).trim()}...`;
  const lastSpace = sliced.lastIndexOf(' ');
  return `${(lastSpace > 20 ? sliced.slice(0, lastSpace) : sliced).trim()}...`;
}

/**
 * Garante que o total de caracteres falados de todos os turnos não ultrapasse o teto de segurança.
 * Isso impede que a geração de áudio no Gemini TTS estoure o limite de 1m20s.
 */
export function enforceAudioScriptCap(turns, maxChars = 680) {
  if (!Array.isArray(turns) || !turns.length) return turns;
  const limit = Math.max(250, Number(maxChars) || 680);
  let total = turns.reduce((acc, t) => acc + (t?.text?.length || 0), 0);
  if (total <= limit) return turns;

  for (const turn of turns) {
    if (total <= limit) break;
    if (turn?.text && turn.text.length > 140) {
      const excess = total - limit;
      const targetLen = Math.max(90, turn.text.length - excess);
      const prevLen = turn.text.length;
      turn.text = truncateForSpeech(turn.text, targetLen);
      total -= (prevLen - turn.text.length);
    }
  }

  // Se ainda assim estiver acima do teto, apara o turno mais longo restante
  if (total > limit) {
    for (const turn of turns) {
      if (total <= limit) break;
      if (turn?.text && turn.text.length > 80) {
        const excess = total - limit;
        const targetLen = Math.max(50, turn.text.length - excess);
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
      text: `Mas que decadência! Até eu cochilei na redação hoje! Ninguém brigou, ninguém passou vergonha... que dia patético!${catchphrase}`,
    });
    turns.push({
      speaker: 'Speaker 1',
      tone: 'fechamento bem-humorado',
      text: 'Pois é. Amanhã a gente volta torcendo por menos paz e mais vontade de tumultuar. Boa noite a todos e até amanhã!',
    });
  } else {
    const capa = truncateForSpeech(edition.capa || 'As confusões do dia pararam a redação', 90);
    const parecer = truncateForSpeech(
      edition.comentarista || cMod.catchphrase || 'Eu acompanhei tudo de perto e digo: a vergonha alheia passou do limite.',
      120
    );
    const detalhes = truncateForSpeech(
      edition.detalhes || 'Nos bastidores, as conversas cruzadas não chegaram a consenso nenhum.',
      110
    );
    const fecho = truncateForSpeech(
      edition.foreshadow || edition.fecho || 'Amanhã tem mais capítulo e a conta dessa zoeira deve chegar.',
      70
    );

    const commentatorLead = commentatorName
      ? ` Para analisar o tamanho dessa loucura, chamo nosso comentarista residente, ${commentatorName}! Fala pra gente, o que você achou dessa história?`
      : ' Para avaliar a situação, acionamos nossa bancada de comentários!';

    turns.push({
      speaker: 'Speaker 1',
      tone: 'entusiasmado e jornalístico',
      text: `Atenção, ouvintes! No ar a edição rápida do The Group Times! Na manchete de hoje: ${capa}.${commentatorLead}`,
    });

    turns.push({
      speaker: 'Speaker 2',
      tone: commentatorActingTone,
      text: `Olha, ouvindo tudo isso eu só digo uma coisa: ${parecer}`,
    });

    turns.push({
      speaker: 'Speaker 1',
      tone: 'investigativo e irônico',
      text: `E tem mais apuração nos bastidores: ${detalhes}. ${fecho}.`,
    });

    if (cMod.catchphrase) {
      turns.push({
        speaker: 'Speaker 2',
        tone: 'enfático com bordão',
        text: `É exatamente por isso que eu sempre afirmo: ${stripWhatsAppFormatting(truncateForSpeech(cMod.catchphrase, 60))}`,
      });
    }

    turns.push({
      speaker: 'Speaker 1',
      tone: 'fechamento dramático',
      text: 'A redação do The Group Times se despede por hoje. Boa noite e cuidem de suas reputações!',
    });
  }

  const cappedTurns = enforceAudioScriptCap(
    turns,
    funConfig?.groupNewsAudioMaxChars || 680
  );

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
    : 45_000;

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
