/**
 * Capa visual do The Group Times — ilustração do dia gerada por IA no publish.
 *
 * Reaproveita EXATAMENTE o motor de imagem do /gerar e /imaginar
 * (imageGenerationService.generateImage — mesma quota global de 25/dia,
 * mesmo registro de telemetria, agora com command='news-cover').
 *
 * Regras da casa:
 * - Prompt determinístico (sem LLM): mood + participantes + pico do horário +
 *   arquétipo do comentarista + tema festivo (festivePalette).
 * - A arte NUNCA depende de texto legível (modelos erram pt-BR na imagem).
 * - Qualquer falha (quota, timeout, provider) é silenciosa: a capa é enfeite,
 *   nunca bloqueia a edição.
 */

import { resolveFestiveSeason } from '../../formatters/festivePalette.js';

/** Comando de telemetria no repositório de gerações (fun_image_generations.command). */
export const NEWS_COVER_COMMAND = 'news-cover';

/** Cena base do dia por mood da conversa (pt-BR, sem pessoas reais). */
const MOOD_COVER_SCENES = {
  zoeiro: 'um clima de zoeira generalizada, risadas e caos divertido entre vizinhos',
  movimentado: 'um tumulto animado de mensagens cruzadas, correria e fofoca no ar',
  conversado: 'uma prosa infinita de mesa de boteco, gestos exagerados e opiniões sem freio',
  silencioso: 'um silêncio de museu, cadeiras vazias e um ventilador girando sozinho',
};

/** Tema festivo por temporada (festivePalette.resolveFestiveSeason). */
const FESTIVE_COVER_THEMES = {
  carnaval: 'clima de carnaval: confetes, purpurina, blocos animados e serpentina',
  sao_joao: 'clima junino: bandeirinhas, fogueira acolhedora, chapéus de palha e milho assando',
  natal: 'clima natalino: neve caindo, luzes e enfeites de Natal, gorros de Papai Noel',
  ano_novo: 'réveillon: fogos de artifício no céu, brilhos dourados e brindes erguidos',
};

/** Caption de fallback por mood quando o texto da edição ainda não decolou. */
const MOOD_COVER_CAPTIONS = {
  zoeiro: '📰 The Group Times — Plantão do Deboche',
  movimentado: '📰 The Group Times — Caos Generalizado na Redação',
  conversado: '📰 The Group Times — A Prosa do Dia',
  silencioso: '📰 The Group Times — Plantão do Silêncio',
};

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

/** Piso do deadline total (proteção contra config zerada; testes podem baixar). */
const COVER_DEADLINE_FLOOR_MS = 50;

/**
 * Prazo TOTAL da capa: o backend de imagem pode tentar vários modelos com
 * timeout próprio (até ~14 min em cascata), o que estouraria a janela
 * 23:59–00:04. Envolve a promise num Promise.race com timer único; o timer
 * é sempre limpo (clearTimeout) pra não vazar handle. generateNewsCover
 * nunca rejeita, então o race é seguro — estourou o prazo, a capa é
 * descartada com { ok:false, reason:'cover-timeout' } e a edição segue.
 */
export function withCoverDeadline(coverPromise, timeoutMs = 90_000) {
  const total = Math.max(COVER_DEADLINE_FLOOR_MS, Math.floor(Number(timeoutMs) || 90_000));
  let timer = null;
  try {
    const deadline = new Promise((resolve) => {
      timer = setTimeout(() => {
        resolve({ ok: false, reason: 'cover-timeout', timedOut: true });
      }, total);
    });
    return Promise.race([Promise.resolve(coverPromise), deadline]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  } catch (error) {
    if (timer) clearTimeout(timer);
    return Promise.resolve({ ok: false, reason: error?.message || 'cover-deadline-error' });
  }
}

/**
 * Temporada festiva do dia do jornal (null quando não há estação).
 * Fuso vem do config do jornal (worldTimezone).
 */
export function resolveNewsCoverFestiveSeason(now = Date.now(), timeZone = 'America/Sao_Paulo') {
  try {
    return resolveFestiveSeason(Number(now) || Date.now(), timeZone) || null;
  } catch {
    return null;
  }
}

/**
 * Monta o prompt pt-BR da capa do jornal representando o dia do grupo.
 * Determinístico: mood, participantes (nomes de exibição), pico horário da
 * timeline, arquétipo do comentarista e tema festivo quando houver estação.
 */
export function buildNewsCoverPrompt({ conversation = {}, commentator = null, festiveSeason = null } = {}) {
  const mood = String(conversation?.mood || 'conversado');
  const scene = MOOD_COVER_SCENES[mood] || MOOD_COVER_SCENES.conversado;

  const names = [
    ...new Set(
      (Array.isArray(conversation?.messages) ? conversation.messages : [])
        .filter((message) => message?.source === 'human' && message?.name)
        .map((message) => String(message.name).trim())
        .filter(Boolean)
    ),
  ].slice(0, 4);

  const timeline = Array.isArray(conversation?.timeline) ? conversation.timeline : [];
  const peak = timeline.reduce(
    (best, block) => (Number(block?.messageCount || 0) > Number(best?.messageCount || 0) ? block : best),
    null
  );

  const parts = [
    'Ilustração editorial estilo capa de jornal satírico de bairro, cartoon colorido, vibrante e bem-humorado, vista da redação:',
    `${scene}.`,
  ];
  if (peak?.hour) {
    parts.push(`Um relógio de parede marcando o pico do movimento às ${peak.hour}.`);
  }
  if (names.length) {
    parts.push(`Figuras caricatas do dia baseadas na turma: ${names.join(', ')}.`);
  }
  if (commentator?.name) {
    const title = commentator.title ? ` (${commentator.title})` : '';
    parts.push(`No canto, o especialista "${commentator.name}"${title} analisa tudo com lupa e sobrancelha arqueada.`);
  }
  const festive = FESTIVE_COVER_THEMES[String(festiveSeason || '')];
  if (festive) {
    parts.push(`Ambientação especial: ${festive}.`);
  }
  parts.push(
    'NÃO escreva nenhum texto, letra, número ou legenda na imagem — a arte não deve conter palavras escritas.'
  );
  return parts.join(' ');
}

/**
 * Caption da capa: manchete da edição quando o texto já decolou; senão,
 * caption determinística pelo mood do dia.
 */
export function resolveNewsCoverCaption(llmBits = null, conversation = {}) {
  const headline = String(llmBits?.capa || '').trim();
  if (headline) return `📰 ${headline}`;
  const mood = String(conversation?.mood || '');
  return MOOD_COVER_CAPTIONS[mood] || MOOD_COVER_CAPTIONS.conversado;
}

/**
 * Gera a capa via o MESMO caminho do /gerar e /imaginar (imageGenerationService).
 * Quota global compartilhada: se exaurida, devolve ok:false e a capa é pulada.
 * Nunca lança — falha é sempre silenciosa.
 */
export async function generateNewsCover({
  scopeKey,
  imageGenerationService = null,
  conversation = {},
  commentator = null,
  funConfig = {},
  now = Date.now(),
  command = NEWS_COVER_COMMAND,
} = {}) {
  if (!imageGenerationService?.generateImage) return { ok: false, reason: 'no-service' };
  try {
    const festiveSeason = resolveNewsCoverFestiveSeason(now, funConfig.worldTimezone);
    const prompt = buildNewsCoverPrompt({ conversation, commentator, festiveSeason });
    const result = await imageGenerationService.generateImage({
      scopeKey,
      userJid: '',
      prompt,
      command,
      withMemory: false,
      now,
    });
    if (!result?.ok) {
      return { ok: false, reason: result?.reason || 'cover-failed', prompt, festiveSeason };
    }
    return {
      ok: true,
      buffer: result.buffer || null,
      url: String(result.url || '').trim(),
      prompt,
      festiveSeason,
    };
  } catch (error) {
    return { ok: false, reason: error?.message || 'cover-error' };
  }
}

/**
 * Envia a capa no WhatsApp (capa → texto → áudio) com até 2 tentativas.
 * Usa o wrapper sendImage do módulo fun (skipGuard) quando disponível;
 * sem transporte disponível, devolve ok:false sem erro.
 */
export async function sendNewsCoverWithRetry(
  sock,
  scopeKey,
  { coverBuffer = null, coverUrl = '', caption = '', mentions = [] } = {},
  {
    sendImage = null,
    maxAttempts = 2,
    delays = [800],
    sleepFn = defaultSleep,
    logger = console,
  } = {}
) {
  if (!coverBuffer && !String(coverUrl || '').trim()) {
    return { ok: false, reason: 'missing-cover' };
  }

  const transport = typeof sendImage === 'function'
    ? async (payload) => sendImage(sock, scopeKey, payload)
    : typeof sock?.sendMessage === 'function'
      ? async (payload) => sock.sendMessage(scopeKey, payload)
      : null;
  if (!transport) return { ok: false, reason: 'no-transport' };

  const payload = {
    imageBuffer: coverBuffer || null,
    imageUrl: String(coverUrl || '').trim(),
    caption: String(caption || '').trim(),
    mentions: Array.isArray(mentions) ? mentions : [],
  };

  const attemptsTotal = Math.max(1, Math.floor(Number(maxAttempts) || 2));
  let lastError = null;
  for (let attempt = 1; attempt <= attemptsTotal; attempt += 1) {
    try {
      const sent = await transport(payload);
      // O guard de envio (rate limit/anti-ban) pode devolver { skipped: true }:
      // não é sucesso e retry não ajuda (guard é persistente) — falha seca.
      if (sent && typeof sent === 'object' && sent.skipped === true) {
        const reason = String(sent.reason || 'skipped');
        logger?.warn?.(`[fun/news] cover send skipped ${String(scopeKey).slice(0, 28)}: ${reason}`);
        return { ok: false, reason, skipped: true, attempts: attempt };
      }
      return { ok: true, attempts: attempt };
    } catch (err) {
      lastError = err;
      logger?.warn?.(
        `[fun/news] cover send attempt ${attempt}/${attemptsTotal} failed ${String(scopeKey).slice(0, 28)}: ${err?.message || err}`
      );
      if (attempt < attemptsTotal) {
        const delayMs = delays[attempt - 1] ?? 800;
        if (delayMs > 0) await sleepFn(delayMs);
      }
    }
  }
  return { ok: false, reason: lastError?.message || 'cover-send-failed', error: lastError };
}
