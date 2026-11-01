/** Jornal das 23:59 — resumo conversacional de cada grupo. */

import { collectDayConversation, conversationToSnapshotPayload } from './news/newsFacts.js';
import { renderEdition } from './news/newsRender.js';
import { composeLlmBits } from './news/newsLlm.js';
import { createNewsCommentatorService, buildNewsQmpQuestion, formatNewsQmpAnnouncement } from './news/newsCommentatorService.js';
import { synthesizeNewsAudio } from './news/newsAudio.js';
import { generateNewsCover, resolveNewsCoverCaption, withCoverDeadline } from './news/newsCover.js';
import { looksSensitiveJournalText } from './news/journalMessagePolicy.js';
import { jidLocalPart, looksLikeOpaqueLid } from '../utils/identity.js';

/** Janela máxima pra considerar uma rodada QMP do jornal como "resultado da enquete" (~36h). */
const NEWS_QMP_RESULT_WINDOW_MS = 36 * 60 * 60_000;

/** Teto de caracteres de uma carta de leitor (/carta). */
const NEWS_LETTER_MAX_CHARS = 300;
/** Intervalo mínimo entre duas cartas do mesmo autor no grupo (ms). */
const NEWS_LETTER_MIN_INTERVAL_MS = 10 * 60 * 1000;
/** Máximo de cartas por autor por dia do jornal (rate-limit diário). */
const NEWS_LETTER_MAX_PER_DAY = 3;
/** Máximo de cartas exibidas na seção "CARTAS DOS LEITORES" da edição. */
const NEWS_LETTERS_PER_EDITION = 3;

/** Reason do crédito de moedas do Destaque do Dia no ledger. */
const NEWS_SPOTLIGHT_REASON = 'news-spotlight';

export function extractEditionMentions(text = '', quotes = [], identityMap = null) {
  const result = new Set();
  const body = String(text || '');
  if (!body) return [];

  // 1. Menções das citações incluídas no jornal cujo número está presente no texto
  for (const quote of quotes || []) {
    for (const rawJid of quote?.mentionedJids || []) {
      const jid = String(rawJid || '').trim();
      if (!jid) continue;
      const local = jidLocalPart(jid);
      if (local && body.includes(`@${local}`)) {
        const canonical = identityMap?.resolve?.(jid) || jid;
        result.add(canonical);
        if (canonical !== jid) result.add(jid);
      }
    }
  }

  // 2. Extração de padrões @digits no texto (ex: @174994885714120 ou @551199999999)
  const mentionMatches = body.matchAll(/@(\d{8,20})\b/g);
  for (const match of mentionMatches) {
    const digits = match[1];
    if (identityMap?.resolve) {
      const resolved = identityMap.resolve(digits);
      if (resolved && resolved !== digits) {
        result.add(resolved);
      }
    }
    if (looksLikeOpaqueLid(digits)) {
      result.add(`${digits}@lid`);
    } else {
      result.add(`${digits}@s.whatsapp.net`);
    }
  }

  return [...result].filter(Boolean);
}

function dayKeyInTz(now, timeZone = 'America/Sao_Paulo') {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(now));
  } catch {
    return new Date(now).toISOString().slice(0, 10);
  }
}

function clockInTz(now, timeZone = 'America/Sao_Paulo') {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date(now));
    return {
      hour: Number(parts.find((part) => part.type === 'hour')?.value) || 0,
      minute: Number(parts.find((part) => part.type === 'minute')?.value) || 0,
    };
  } catch {
    const date = new Date(now);
    return { hour: date.getHours(), minute: date.getMinutes() };
  }
}

/** Janela do jornal: 23:59–00:04, tolerante ao tick de 45s. */
export function isGroupNewsWindow(now, funConfig = {}) {
  const timeZone = funConfig.worldTimezone || 'America/Sao_Paulo';
  const targetHour = Number.isFinite(Number(funConfig.groupNewsHour)) ? Number(funConfig.groupNewsHour) : 23;
  const targetMinute = Number.isFinite(Number(funConfig.groupNewsMinute)) ? Number(funConfig.groupNewsMinute) : 59;
  const { hour, minute } = clockInTz(now, timeZone);
  return (hour === targetHour && minute >= targetMinute) ||
    (targetHour === 23 && targetMinute >= 55 && hour === 0 && minute <= 4);
}

export function createNewsService({
  newsRepository,
  journalMessageRepository = null,
  snapshotRepository = null,
  flavorService = null,
  getContactDisplayName = null,
  identityMap = null,
  random = Math.random,
  commentatorService = null,
  groupMemoryService = null,
  personaService = null,
  getPersonaService = null,
  socialMemoryService = null,
  ttsService = null,
  getTtsService = null,
  statsRepository = null,
  qmpRepository = null,
  quoteQuizRepository = null,
  lettersRepository = null,
  imageGenerationService = null,
} = {}) {
  const resolveCurrentPersonaService = () =>
    personaService || (typeof getPersonaService === 'function' ? getPersonaService() : null);

  const resolveCurrentTtsService = () =>
    ttsService || (typeof getTtsService === 'function' ? getTtsService() : null);

  const resolvedCommentatorService =
    commentatorService ||
    createNewsCommentatorService({
      newsRepository,
      get personaService() {
        return resolveCurrentPersonaService();
      },
      groupMemoryService,
      socialMemoryService,
      random,
    });

  // Idempotência do commit pós-post por (escopo|dia do jornal): garante que um
  // commit repetido (ou re-commit após setNewsDay falhar) não credite moedas
  // duas vezes. Em memória — o gate persistente de re-execução é o setNewsDay.
  const committedEditions = new Set();
  const committedSpotlights = new Set();
  /** Composições por (escopo|dia) — trava re-post em spam: sem commit ok, no máximo 2 por dia por processo. */
  const composeAttempts = new Map();
  /** Janela de busca do evento durável de crédito (cobre toda a janela 23:59–00:04 com folga). */
  const SPOTLIGHT_DEDUP_WINDOW_MS = 30 * 60 * 1000;

  /**
   * Dedup durável do crédito do Destaque: procura o evento
   * 'news-spotlight-credit' do (escopo, newsDay) em fun_daily_events —
   * sobrevive a restart (o Set em memória não). A janela de retry é a mesma
   * da retenção da tabela (prune no commit).
   */
  function hasDurableSpotlightCredit(scopeKey, newsDay, targetNow) {
    if (!newsRepository?.listSince) return false;
    try {
      const since = Number(targetNow) - SPOTLIGHT_DEDUP_WINDOW_MS;
      const events = newsRepository.listSince(scopeKey, since) || [];
      return events.some(
        (event) =>
          String(event?.eventType || '') === 'news-spotlight-credit' &&
          String(event?.payload?.newsDay || '') === String(newsDay || '')
      );
    } catch {
      return false;
    }
  }

  function enabled(funConfig = {}) {
    return funConfig.groupNewsEnabled !== false;
  }

  // Mantém a API para produtores de eventos legados. Esses dados não entram mais
  // no texto publicado, mas continuam úteis para telemetria durante a transição.
  function log(scopeKey, eventType, { userJid = null, payload = {}, now = Date.now() } = {}) {
    try {
      return newsRepository?.logEvent?.({ scopeKey, eventType, userJid, payload, now }) || null;
    } catch {
      return null;
    }
  }

  /**
   * Última rodada QMP aberta pelo jornal (source='news'), resolvida e com
   * votos, dentro da janela de ~36h. Sem resultado → null (linha omitida).
   */
  function resolveNewsQmpResult(scopeKey, now = Date.now()) {
    if (!qmpRepository?.listRecentRounds) return null;
    try {
      // Resolve rodadas expiradas ainda 'active' (fechamento preguiçoso do QMP)
      qmpRepository.closeExpired?.(scopeKey, now);
      const rounds = qmpRepository.listRecentRounds(scopeKey, 10) || [];
      const since = now - NEWS_QMP_RESULT_WINDOW_MS;
      for (const round of rounds) {
        const question = round?.question || {};
        const resolvedAt = Number(question.closedAt || question.createdAt || 0);
        if (!resolvedAt || resolvedAt < since) break;
        if (String(question.source || '') !== 'news') continue;
        if (!round.totalVotes || !round.winnerJid) continue;
        const fallbackName = String(round.winnerJid || '').split('@')[0];
        const winner = String(
          getContactDisplayName?.(round.winnerJid) || fallbackName || 'alguém'
        ).trim();
        return {
          prompt: String(question.prompt || '').trim(),
          winner,
          votes: Number(round.totalVotes) || 0,
        };
      }
    } catch {
      // Enquete é enfeite: falha na leitura nunca quebra a edição
    }
    return null;
  }

  /**
   * Abre a rodada QMP do comentarista residente ao fim da edição.
   * Determinística (template por arquétipo, sem LLM) e inofensiva: qualquer
   * guarda falhando apenas devolve { ok:false } — nunca quebra o jornal.
   *
   * Desvio documentado do contrato: `qmpService.startRound` coerça qualquer
   * source com customText para 'custom', o que impediria distinguir rodadas
   * do jornal de rodadas de usuário. Por isso a rodada é criada direto via
   * `qmpRepository.createQuestion` (source='news'), replicando os guardas do
   * serviço (habilitado/rodada ativa/expiração) sem tocar no serviço do QMP.
   */
  function openCommentatorQmpRound(
    scopeKey,
    {
      funConfig = {},
      now = Date.now(),
      commentator = null,
      conversation = {},
      random: randomFn = null,
      isCommandEnabled = null,
    } = {}
  ) {
    try {
      if (funConfig.groupNewsQmpEnabled === false) return { ok: false, reason: 'disabled' };
      if (funConfig.qmpEnabled === false) return { ok: false, reason: 'qmp-disabled' };
      if (typeof isCommandEnabled === 'function' && !isCommandEnabled()) {
        return { ok: false, reason: 'qmp-command-disabled' };
      }
      if (!qmpRepository?.createQuestion || !scopeKey) return { ok: false, reason: 'no-repository' };

      // Guarda: rodada QMP ativa no grupo impede nova abertura
      qmpRepository.closeExpired?.(scopeKey, now);
      if (qmpRepository.getActiveQuestion?.(scopeKey, now)) {
        return { ok: false, reason: 'active-exists' };
      }
      if (!commentator?.name) return { ok: false, reason: 'no-commentator' };

      const question = buildNewsQmpQuestion(commentator, conversation, randomFn || random);
      if (!question) return { ok: false, reason: 'empty-question' };

      const roundDurationMs = Math.max(
        60_000,
        Math.floor(Number(funConfig.qmpRoundDurationMs) || 10 * 60_000)
      );
      const created = qmpRepository.createQuestion({
        scopeKey,
        prompt: question,
        source: 'news',
        tone: 'normal',
        createdBy: '',
        expiresAt: now + roundDurationMs,
        now,
      });
      if (!created?.id) return { ok: false, reason: 'create-failed' };

      return {
        ok: true,
        question: created,
        announcement: formatNewsQmpAnnouncement(question, commentator),
      };
    } catch (error) {
      console.warn(
        `[fun/news] qmp round fail scope=${String(scopeKey).slice(0, 28)}: ${error?.message || error}`
      );
      return { ok: false, reason: error?.message || 'qmp-error' };
    }
  }

  /**
   * Destaque do Dia: escolhe o autor homenageado SOMENTE de dados
   * estruturados — primário: autor da quote de maior score (quotes[0]);
   * fallback: autor com mais mensagens no dia. NUNCA deriva da prosa da
   * LLM nem de menções soltas no texto. Sem participante do dia → null.
   */
  function resolveNewsSpotlightAuthor(conversation = {}) {
    const quotes = Array.isArray(conversation?.quotes) ? conversation.quotes : [];
    const topQuote = quotes.find((quote) => String(quote?.authorJid || '').trim());
    if (topQuote?.authorJid) {
      return {
        authorJid: String(topQuote.authorJid),
        source: 'top-quote',
        score: Number(topQuote.score) || 0,
      };
    }

    const counts = new Map();
    for (const message of Array.isArray(conversation?.messages) ? conversation.messages : []) {
      if (String(message?.source || 'human') !== 'human') continue;
      const jid = String(message?.authorJid || '').trim();
      if (!jid) continue;
      counts.set(jid, (counts.get(jid) || 0) + 1);
    }
    let best = null;
    for (const [jid, count] of counts) {
      if (!best || count > best.count) best = { authorJid: jid, source: 'top-messages', count };
    }
    return best;
  }

  /**
   * Correio dos leitores (/carta): valida o texto, aplica rate-limit por
   * autor (3/dia e intervalo mínimo de ~10 min) e persiste a carta no dia
   * do jornal. Nunca lança — devolve { ok:false, reason } pro handler
   * traduzir em mensagem amigável.
   */
  function recordLetter(scopeKey, { authorJid = '', text = '', now = Date.now(), funConfig = {} } = {}) {
    try {
      const scope = String(scopeKey || '').trim();
      const author = String(authorJid || '').trim();
      if (!scope.endsWith('@g.us')) return { ok: false, reason: 'not-group' };
      if (!author) return { ok: false, reason: 'no-author' };
      if (!lettersRepository?.recordLetter) return { ok: false, reason: 'no-repository' };

      const body = String(text || '').trim();
      if (!body) return { ok: false, reason: 'empty-text' };
      if (body.length > NEWS_LETTER_MAX_CHARS) return { ok: false, reason: 'too-long' };
      if (looksSensitiveJournalText(body)) return { ok: false, reason: 'sensitive' };

      const timeZone = funConfig.worldTimezone || 'America/Sao_Paulo';
      const ts = Number(now) || Date.now();
      const dayKey = dayKeyInTz(ts, timeZone);

      const last = lettersRepository.getLastLetterByAuthor?.(scope, author) || null;
      if (last && ts - Number(last.createdAt || 0) < NEWS_LETTER_MIN_INTERVAL_MS) {
        return { ok: false, reason: 'cooldown' };
      }
      const todayCount = lettersRepository.countByAuthorOnDay?.(scope, { authorJid: author, dayKey }) || 0;
      if (todayCount >= NEWS_LETTER_MAX_PER_DAY) return { ok: false, reason: 'daily-limit' };

      const letter = lettersRepository.recordLetter({
        scopeKey: scope,
        authorJid: author,
        text: body,
        dayKey,
        now: ts,
      });
      if (!letter) return { ok: false, reason: 'persist-failed' };
      return { ok: true, letter };
    } catch (error) {
      console.warn(
        `[fun/news] letter record fail ${String(scopeKey).slice(0, 28)}: ${error?.message || error}`
      );
      return { ok: false, reason: 'letter-error' };
    }
  }

  /**
   * Cartas do dia do jornal pra seção "CARTAS DOS LEITORES" (determinística,
   * no máximo NEWS_LETTERS_PER_EDITION). Falha de leitura devolve [] e a
   * seção simplesmente não aparece.
   */
  function listLettersForDay(scopeKey, { dayKey = '', limit = NEWS_LETTERS_PER_EDITION } = {}) {
    try {
      if (!lettersRepository?.listLettersForDay || !dayKey) return [];
      return lettersRepository.listLettersForDay(scopeKey, { dayKey, limit }) || [];
    } catch {
      return [];
    }
  }

  async function composeEdition(scopeKey, funConfig = {}, now = Date.now()) {
    const timeZone = funConfig.worldTimezone || 'America/Sao_Paulo';
    const conversation = collectDayConversation({
      scopeKey,
      now,
      timeZone,
      deps: { journalMessageRepository, snapshotRepository },
      getContactDisplayName,
      readLimit: funConfig.groupNewsMessageReadLimit,
      conversationMaxChars: funConfig.groupNewsConversationMaxChars,
    });

    const commentator =
      resolvedCommentatorService?.resolveCommentator?.(scopeKey, { now, mood: conversation?.mood }) || null;
    const currentPersonaService = resolveCurrentPersonaService();

    // Capa visual por IA: decola EM PARALELO com a composição do texto
    // (janela 23:59–00:04 é apertada). Prazo TOTAL (groupNewsCoverTimeoutMs,
    // padrão 90s) porque o backend de imagem pode tentar vários modelos em
    // cascata; estourou, a capa é descartada e a edição segue. Falha é
    // sempre silenciosa — capa é enfeite.
    const coverEnabled =
      funConfig.groupNewsCoverEnabled !== false && Boolean(imageGenerationService?.generateImage);
    const coverDeadlineMs = Math.max(
      50,
      Math.floor(Number(funConfig.groupNewsCoverTimeoutMs) || 90_000)
    );
    const coverPromise = coverEnabled
      ? withCoverDeadline(
          generateNewsCover({
            scopeKey,
            imageGenerationService,
            conversation,
            commentator,
            funConfig,
            now,
          }),
          coverDeadlineMs
        )
      : null;

    let groupStyle = '';
    try {
      groupStyle = currentPersonaService?.buildStyleBlock?.(scopeKey) || '';
    } catch {
      groupStyle = '';
    }

    let groupLore = '';
    try {
      groupLore = groupMemoryService?.buildLoreContext?.(scopeKey, {
        limit: 12,
        funConfig,
        now,
      }) || '';
    } catch {
      groupLore = '';
    }

    let socialVibe = '';
    try {
      if (typeof socialMemoryService?.toIdentityInput === 'function') {
        const identity = socialMemoryService.toIdentityInput();
        if (Array.isArray(identity?.voiceStyle) && identity.voiceStyle.length) {
          socialVibe = identity.voiceStyle.join(', ');
        }
      }
    } catch {
      socialVibe = '';
    }

    const llmBits = await composeLlmBits(
      conversation,
      flavorService,
      scopeKey,
      random,
      groupMemoryService,
      funConfig,
      {
        commentator,
        groupStyle,
        socialVibe,
        groupLore,
      }
    );

    const dayLabel = `${dayKeyInTz(now, timeZone)} · ${new Date(now).toLocaleDateString('pt-BR', { weekday: 'long', timeZone })}`;
    const qmpResult = resolveNewsQmpResult(scopeKey, now);
    // Correio dos leitores: cartas registradas no dia do jornal (determinístico, sem LLM).
    const lettersForEdition = listLettersForDay(scopeKey, { dayKey: dayKeyInTz(now, timeZone) }).map((letter) => ({
      name:
        String(getContactDisplayName?.(letter.authorJid) || '').trim() ||
        String(letter.authorJid || '').split('@')[0] ||
        'Anônimo',
      text: String(letter.text || '').trim(),
    }));
    const text = renderEdition(conversation, llmBits, {
      dayLabel,
      random,
      commentator,
      commentatorService: resolvedCommentatorService,
      maxChars: funConfig.groupNewsMaxChars || 2500,
      qmpResult,
      letters: lettersForEdition,
    });
    const provider = llmBits?.capa ? 'llm-enhanced' : 'deterministic';
    const mentions = extractEditionMentions(text, conversation.quotes, identityMap);

    let audio = null;
    const effectiveTts = resolveCurrentTtsService();
    if (effectiveTts?.isAvailable?.() && funConfig.groupNewsAudioEnabled !== false) {
      try {
        const audioResult = await synthesizeNewsAudio({
          edition: llmBits || {
            capa: conversation.quiet ? 'Plantão do Silêncio' : 'Edição Especial',
            intro: text,
          },
          commentator,
          conversation,
          ttsService: effectiveTts,
          funConfig,
        });
        if (audioResult?.ok && audioResult.buffer) {
          audio = audioResult;
        }
      } catch (audioErr) {
        console.warn(
          `[fun/news] audio generation failed scope=${String(scopeKey).slice(0, 28)}: ${audioErr?.message || audioErr}`
        );
      }
    }

    let cover = null;
    if (coverPromise) {
      try {
        const coverResult = await coverPromise;
        if (coverResult?.ok && (coverResult.buffer || coverResult.url)) {
          cover = {
            buffer: coverResult.buffer || null,
            url: coverResult.url || '',
            prompt: coverResult.prompt || '',
            festiveSeason: coverResult.festiveSeason || null,
          };
        }
      } catch (coverErr) {
        console.warn(
          `[fun/news] cover generation failed scope=${String(scopeKey).slice(0, 28)}: ${coverErr?.message || coverErr}`
        );
      }
    }
    const coverCaption = cover ? resolveNewsCoverCaption(llmBits, conversation) : '';

    console.log(
      `[fun/news] edition scope=${String(scopeKey).slice(0, 28)} provider=${provider} messages=${conversation.totalMessageCount} mood=${conversation.mood} mentions=${mentions.length} audio=${Boolean(audio?.buffer)} cover=${Boolean(cover)}`
    );

    return {
      text,
      provider,
      eventCount: 0,
      messageCount: conversation.totalMessageCount,
      facts: conversation,
      mentions,
      commentator,
      cover,
      coverCaption,
      audioBuffer: audio?.buffer || null,
      audioMimeType: audio?.mimeType || null,
      audioTranscript: audio?.transcriptData || null,
    };
  }

  async function tryPublish(scopeKey, funConfig = {}, now = Date.now()) {
    if (!enabled(funConfig)) return { ok: false, reason: 'disabled' };
    if (!isGroupNewsWindow(now, funConfig)) return { ok: false, reason: 'not-window' };

    const timeZone = funConfig.worldTimezone || 'America/Sao_Paulo';
    const { hour } = clockInTz(now, timeZone);
    const targetNow = hour === 0 ? now - 2 * 60 * 60_000 : now;
    const newsDay = dayKeyInTz(targetNow, timeZone);
    const meta = newsRepository?.getNewsMeta?.(scopeKey);
    if (meta?.lastDailyNewsDay === newsDay) return { ok: false, reason: 'already-today' };

    // Trava de re-composição (teto por processo): com o gate do dia aberto
    // (post/commit falharam), recompor queima LLM + capa — no máximo 2
    // tentativas por (escopo, dia); a 3ª devolve recompose-limit SEM compor.
    const composeKey = `${String(scopeKey || '')}|${newsDay}`;
    const composeCount = composeAttempts.get(composeKey) || 0;
    if (composeCount >= 2) {
      return { ok: false, reason: 'recompose-limit', newsDay };
    }
    composeAttempts.set(composeKey, composeCount + 1);
    if (composeAttempts.size > 10_000) composeAttempts.clear();

    const edition = await composeEdition(scopeKey, funConfig, targetNow);

    // Destaque do Dia: computado SÓ de dados estruturados (quote de maior
    // score ou autor mais ativo). A linha e a mention entram na edição AQUI;
    // o CRÉDITO em coins só acontece no commitEdition (depois do post ok).
    let spotlight = null;
    if (funConfig.groupNewsSpotlightEnabled !== false) {
      try {
        const chosen = resolveNewsSpotlightAuthor(edition.facts);
        const amount = Math.max(0, Math.floor(Number(funConfig.groupNewsSpotlightCoins) || 50));
        if (chosen?.authorJid && amount > 0) {
          const spotlightName =
            String(getContactDisplayName?.(chosen.authorJid) || '').trim() ||
            String(chosen.authorJid).split('@')[0] ||
            'alguém';
          spotlight = { ...chosen, name: spotlightName, amount, committed: false, credited: false, coins: 0 };
        }
      } catch (error) {
        console.warn(`[fun/news] spotlight fail ${String(scopeKey).slice(0, 28)}: ${error?.message || error}`);
      }
    }

    // Linha determinística do destaque no fim da edição (respeita o budget).
    // Âncora de menção no padrão da casa: @<parte do JID> (extractEditionMentions
    // casa @\d{8,20}) + nome legível entre parênteses pra leitura humana.
    let editionText = edition.text;
    if (spotlight?.authorJid && editionText) {
      const anchor = jidLocalPart(spotlight.authorJid) || spotlight.name;
      const spotlightLine = `\n\n⭐ *DESTAQUE DO DIA*: @${anchor} (${spotlight.name})`;
      const maxChars = Number(funConfig.groupNewsMaxChars) || 2500;
      if (!Number.isFinite(maxChars) || maxChars <= 0 || editionText.length + spotlightLine.length <= maxChars) {
        editionText = editionText + spotlightLine;
      }
    }

    // Mention do homenageado (mesma resolução de identidade das citações).
    const editionMentions = [...(edition.mentions || [])];
    if (spotlight?.authorJid) {
      try {
        const canonical = identityMap?.resolve?.(spotlight.authorJid) || spotlight.authorJid;
        for (const jid of [canonical, spotlight.authorJid]) {
          if (jid && !editionMentions.includes(jid)) editionMentions.push(jid);
        }
      } catch {
        // mention é enfeite: falha de identidade nunca quebra a edição
      }
    }

    return {
      ok: true,
      text: editionText,
      provider: edition.provider,
      eventCount: edition.eventCount,
      messageCount: edition.messageCount,
      newsDay,
      mentions: editionMentions,
      commentator: edition.commentator || null,
      spotlight,
      cover: edition.cover || null,
      coverCaption: edition.coverCaption || '',
      audioBuffer: edition.audioBuffer || null,
      audioMimeType: edition.audioMimeType || null,
      audioTranscript: edition.audioTranscript || null,
      // Efeitos colaterais pendentes: NADA foi persistido/creditado/marcado
      // ainda. O index.js chama commitEdition() DEPOIS do post bem-sucedido —
      // post falho deixa o dia livre pro tick seguinte recompor a edição.
      targetNow,
      pendingCommit: true,
      commit: {
        newsDay,
        targetNow,
        topQuote: (Array.isArray(edition.facts?.quotes) ? edition.facts.quotes[0] : null) || null,
        snapshotPayload: conversationToSnapshotPayload(edition.facts),
      },
    };
  }

  /**
   * COMMIT dos efeitos colaterais do jornal — roda DEPOIS do post bem-sucedido
   * (index.js). Ordem: crédito do Destaque (idempotente por escopo/dia) →
   * quote do quiz → snapshot + prunes → setNewsDay POR ÚLTIMO (dia marcado =
   * commit concluído). Erro em um efeito não aborta os demais; o commit
   * falhando NUNCA invalida a edição já publicada.
   */
  function commitEdition(scopeKey, result, funConfig = {}, now = Date.now()) {
    if (!result?.ok || !result?.newsDay || !result?.commit) {
      return { ok: false, reason: 'invalid-result' };
    }
    const commitKey = `${String(scopeKey || '')}|${result.newsDay}`;
    if (committedEditions.has(commitKey)) {
      return { ok: false, reason: 'already-committed', newsDay: result.newsDay };
    }
    const { newsDay, targetNow, topQuote, snapshotPayload } = result.commit;

    // 1) Crédito do Destaque do Dia — idempotência em DUAS camadas: evento
    // durável 'news-spotlight-credit' em fun_daily_events (sobrevive a restart)
    // + Set em memória por (escopo|dia). O Set só marca quando o crédito
    // realmente ok (ou não aplicável): addCoins devolvendo {ok:false} sem
    // lançar NÃO marca — re-commit pode tentar de novo (B3).
    const spotlight = result.spotlight || null;
    let credited = false;
    let coins = 0;
    let creditSettled = true;
    const spotlightKey = `${String(scopeKey || '')}|${newsDay}`;
    try {
      if (spotlight?.authorJid && !committedSpotlights.has(spotlightKey)) {
        const amount = Math.max(0, Math.floor(Number(spotlight.amount) || 0));
        const alreadyCredited = hasDurableSpotlightCredit(scopeKey, newsDay, targetNow);
        const canCredit = !alreadyCredited && amount > 0 && Boolean(statsRepository?.addCoins);
        let creditOk = alreadyCredited;
        if (canCredit) {
          const credit = statsRepository.addCoins({
            userJid: spotlight.authorJid,
            scopeKey,
            amount,
            now: targetNow,
            reason: NEWS_SPOTLIGHT_REASON,
          });
          creditOk = Boolean(credit?.ok);
          coins = Number(credit?.coins) || 0;
          if (creditOk) {
            log(scopeKey, 'news-spotlight-credit', {
              userJid: spotlight.authorJid,
              payload: { newsDay, userJid: spotlight.authorJid, amount },
              now: targetNow,
            });
          }
        }
        credited = creditOk;
        if (creditOk || !canCredit) {
          // Resolvido: creditado agora, já creditado antes (durável), ou nada
          // a fazer (skip/amount 0/sem statsRepository).
          committedSpotlights.add(spotlightKey);
        } else {
          creditSettled = false;
        }
      } else if (spotlight?.authorJid) {
        credited = true;
      }
    } catch (error) {
      console.warn(`[fun/news] spotlight credit fail ${String(scopeKey).slice(0, 28)}: ${error?.message || error}`);
      creditSettled = false;
    }
    if (committedSpotlights.size > 10_000) committedSpotlights.clear();

    // 2) Fonte do quiz "Quem disse essa frase?" (upsert idempotente).
    try {
      if (quoteQuizRepository?.saveTopQuote && topQuote?.text && topQuote?.authorJid) {
        quoteQuizRepository.saveTopQuote({
          scopeKey,
          dayKey: newsDay,
          quoteText: topQuote.text,
          authorJid: topQuote.authorJid,
          authorName: topQuote.name || '',
          score: Number(topQuote.score) || 0,
          now: targetNow,
        });
      }
    } catch (error) {
      console.warn(`[fun/news] quote quiz persist fail ${String(scopeKey).slice(0, 28)}: ${error?.message || error}`);
    }

    // 3) Snapshot histórico + prunes de retenção (todos idempotentes).
    try {
      snapshotRepository?.saveSnapshot?.({
        scopeKey,
        dayKey: newsDay,
        payload: snapshotPayload,
        now: targetNow,
      });
      const retentionDays = Math.max(1, Number(funConfig.groupNewsMessageRetentionDays) || 3);
      journalMessageRepository?.pruneOlderThan?.(scopeKey, targetNow - retentionDays * 24 * 60 * 60_000);
      newsRepository?.pruneOlderThan?.(scopeKey, targetNow - 3 * 24 * 60 * 60_000);
      quoteQuizRepository?.pruneOlderThan?.(scopeKey, targetNow - 3 * 24 * 60 * 60_000);
      lettersRepository?.pruneOlderThan?.(scopeKey, targetNow - 3 * 24 * 60 * 60_000);
    } catch (error) {
      console.warn(`[fun/news] cleanup fail ${String(scopeKey).slice(0, 28)}: ${error?.message || error}`);
    }

    // 4) Gate do dia POR ÚLTIMO: marcado = commit concluído. Falha aqui deixa
    // o tick seguinte recompor (o crédito já é idempotente, sem duplo-spend).
    try {
      newsRepository?.setNewsDay?.(scopeKey, newsDay, Number(now) || targetNow);
    } catch (error) {
      console.warn(`[fun/news] set news day fail ${String(scopeKey).slice(0, 28)}: ${error?.message || error}`);
      return {
        ok: false,
        reason: 'set-news-day-failed',
        newsDay,
        spotlight: spotlight ? { ...spotlight, committed: true, credited, coins, settled: creditSettled } : null,
      };
    }

    // Crédito pendente com dia JÁ marcado: a linha "⭐ DESTAQUE DO DIA" foi
    // publicada mas as coins não saíram (addCoins {ok:false} sem lançar) —
    // loga alto pra não ficar silencioso; o re-commit pode retentar (B3).
    if (!creditSettled && spotlight?.authorJid) {
      console.warn(
        `[fun/news] spotlight credit PENDING scope=${String(scopeKey).slice(0, 28)} day=${newsDay}: ` +
        `linha publicada sem crédito confirmado (user=${String(spotlight.authorJid).slice(0, 28)}, ` +
        `amount=${spotlight.amount}); re-commit pode retentar`
      );
    }

    // Commit "oficializado" só quando o crédito está resolvido: com crédito
    // pendente ({ok:false} sem lançar), o re-commit pode tentar de novo (B3).
    if (creditSettled) {
      committedEditions.add(commitKey);
      if (committedEditions.size > 10_000) committedEditions.clear();
    }
    return {
      ok: true,
      newsDay,
      spotlight: spotlight ? { ...spotlight, committed: true, credited, coins, settled: creditSettled } : null,
    };
  }

  return {
    enabled,
    log,
    composeEdition,
    tryPublish,
    commitEdition,
    isGroupNewsWindow,
    dayKeyInTz,
    openCommentatorQmpRound,
    resolveNewsQmpResult,
    resolveNewsSpotlightAuthor,
    recordLetter,
    listLettersForDay,
  };
}
