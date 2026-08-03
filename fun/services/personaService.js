/**
 * Persona (Bot Membro Vivo) — o bot responde como membro comum do grupo
 * quando citado como "bot" (palavra inteira) ou marcado via @.
 *
 * Camada de serviço: detecção de gatilho, guardas (cooldown, quiet hours,
 * anti-self-loop, toggle por grupo), gestão de threads de conversa,
 * aprendizado de estilo (janela rolante em memória + perfil persistido) e
 * geração de resposta via Zen + fallback estático.
 *
 * Não modifica o flavorService (OCP): reutiliza sanitizeFlavor e
 * looksLikeScoreboardEcho exportados.
 */

import { sanitizeFlavor, looksLikeScoreboardEcho } from '../llm/flavorService.js';
import { openaiChatComplete } from '../llm/openaiClient.js';
import { resolveZenTaskParams } from '../llm/zenTaskParams.js';
import { PERSONA_DERIVE_INTERVAL_MS } from '../constants.js';

/** Chamadas textuais inequívocas ao bot; menções @ e replies são tratados separadamente. */
const MENTION_RE = /^\s*(?:bot(?:\s|[?!,.:;]|$)|ei\s+bot(?:\s|[?!,.:;]|$))/iu;

const STOPWORDS = new Set([
  'de', 'a', 'o', 'que', 'e', 'do', 'da', 'em', 'um', 'para', 'com', 'não',
  'uma', 'os', 'no', 'se', 'na', 'por', 'mais', 'as', 'dos', 'como', 'mas',
  'ao', 'ele', 'das', 'à', 'seu', 'sua', 'ou', 'quando', 'muito', 'nos',
  'já', 'isso', 'também', 'só', 'pelo', 'pela', 'até', 'ela', 'entre',
  'era', 'depois', 'sem', 'mesmo', 'aos', 'ter', 'seus', 'quem', 'nas',
  'me', 'esse', 'eles', 'você', 'está', 'mas', 'foi', 'qual', 'tem',
  'the', 'and', 'for', 'are', 'you', 'bot', 'botao',
]);

const EMOJI_RE = /\p{Extended_Pictographic}/gu;

const FALLBACK_LINES = [
  'kkkkk relaxa',
  'oi',
  'não errei não, foi mal',
  'achei engrç',
  'sei lá mano',
  'eh',
  'demorou',
  'tá ligado',
  'saudades de quando o zap era bom',
  'mds',
];

function anonymizeLine(text) {
  return String(text || '')
    .replace(/@\d{5,}/g, '[nome]')
    .replace(/\b\d{10,}\b/g, '[nome]')
    .slice(0, 200);
}

function extractTokens(text) {
  const words = String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  return words;
}

function extractEmojis(text) {
  const matches = String(text || '').match(EMOJI_RE);
  return matches || [];
}

function pickRotation(i, arr) {
  if (!arr.length) return '';
  return arr[i % arr.length];
}

export function createPersonaService({
  personaRepository,
  groupRepository,
  threadContextService = null,
  personaSocialHintService = null,
  getLogger = () => null,
  random = Math.random,
} = {}) {
  if (!personaRepository) throw new Error('[fun/personaService] personaRepository required');
  if (!groupRepository) throw new Error('[fun/personaService] groupRepository required');

  const logger = getLogger();

  /** @type {Map<string, number>} */
  const cooldowns = new Map();
  /** @type {Set<string>} */
  const inFlightScopes = new Set();
  /** @type {Map<string, { msgs: Array<{ userJid: string, text: string, at: number }>, updatedAt: number }>} */
  const windows = new Map();

  function opts(funConfig = {}) {
    return {
      enabled: funConfig.personaEnabled !== false,
      cooldownMs: Number(funConfig.personaCooldownMs) || 60_000,
      maxTurns: Math.min(4, Math.max(2, Number(funConfig.personaMaxTurns) || 3)),
      threadTtlMs: Number(funConfig.personaThreadTtlMs) || 30 * 60_000,
      windowSize: Number(funConfig.personaWindowSize) || 100,
      windowMs: Number(funConfig.personaWindowMs) || 24 * 60 * 60 * 1000,
      timeoutMs: Number(funConfig.personaTimeoutMs) || 15_000,
      maxChars: Number(funConfig.personaMaxChars) || 400,
      deriveIntervalMs: Number(funConfig.personaDeriveIntervalMs) || PERSONA_DERIVE_INTERVAL_MS,
    };
  }

  function normalizeJid(raw) {
    const jid = String(raw || '').trim();
    if (!jid) return '';
    const at = jid.indexOf('@');
    const user = at >= 0 ? jid.slice(0, at).split(':')[0] : jid.split(':')[0];
    const domain = at >= 0 ? jid.slice(at) : '@s.whatsapp.net';
    return user ? `${user}${domain}` : '';
  }

  function resolveJid(raw, identityMap) {
    const jid = normalizeJid(raw);
    if (!jid) return '';
    const mapped = identityMap?.resolve ? normalizeJid(identityMap.resolve(jid)) : '';
    return mapped || jid;
  }

  function collectBotJids(sock, identityMap, extraJids = []) {
    const candidates = [
      sock?.user?.id, sock?.user?.lid, sock?.user?.pn, sock?.user?.jid,
      sock?.authState?.creds?.me?.id, sock?.authState?.creds?.me?.lid,
      sock?.authState?.creds?.me?.pn, sock?.authState?.creds?.me?.jid,
      ...extraJids,
    ];
    const identities = new Set();
    for (const candidate of candidates) {
      const raw = normalizeJid(candidate);
      const resolved = resolveJid(raw, identityMap);
      if (raw) identities.add(raw);
      if (resolved) identities.add(resolved);
    }
    return identities;
  }

  function detectTrigger({ text, mentionedJids = [], botJid, botJids = [], identityMap }) {
    const mention = Boolean(text && MENTION_RE.test(String(text)));
    const identities = collectBotJids(null, identityMap, [botJid, ...botJids]);
    const atMention = Array.isArray(mentionedJids) && mentionedJids.some((jid) => {
      const raw = normalizeJid(jid);
      return identities.has(raw) || identities.has(resolveJid(raw, identityMap));
    });
    return { mention, atMention };
  }

  function isTextMessage(messageType) {
    const type = String(messageType || 'text').toLowerCase();
    return type === 'text' || type === 'extended-text';
  }

  function isInCooldown(scopeKey, now, cooldownMs) {
    const last = cooldowns.get(scopeKey) || 0;
    return now - last < cooldownMs;
  }

  function setCooldown(scopeKey, now) {
    cooldowns.set(scopeKey, Number(now) || Date.now());
  }

  function getWindow(scopeKey, windowSize, windowMs, now) {
    let w = windows.get(scopeKey);
    if (!w) {
      w = { msgs: [], updatedAt: 0 };
      windows.set(scopeKey, w);
    }
    const cutoff = now - windowMs;
    w.msgs = w.msgs.filter((m) => m.at >= cutoff);
    if (w.msgs.length > windowSize) {
      w.msgs = w.msgs.slice(-windowSize);
    }
    return w;
  }

  function observeMessage({ scopeKey, userJid, text, messageType = 'text', funConfig = {}, now = Date.now() }) {
    try {
      const o = opts(funConfig);
      if (!o.enabled) return { observed: false, reason: 'disabled' };
      const s = String(scopeKey || '');
      if (!s.endsWith('@g.us')) return { observed: false, reason: 'invalid' };
      if (!isTextMessage(messageType)) {
        return { observed: false, reason: 'type' };
      }
      const body = String(text || '').trim();
      if (!body || body.length < 3) return { observed: false, reason: 'short' };

      const w = getWindow(s, o.windowSize, o.windowMs, Number(now) || Date.now());
      w.msgs.push({
        userJid: String(userJid || ''),
        text: body.slice(0, o.maxChars),
        at: Number(now) || Date.now(),
      });
      if (w.msgs.length > o.windowSize) {
        w.msgs = w.msgs.slice(-o.windowSize);
      }
      w.updatedAt = Number(now) || Date.now();
      return { observed: true };
    } catch {
      return { observed: false, reason: 'error' };
    }
  }

  function deriveAndPersistProfile(scopeKey, funConfig = {}, now = Date.now()) {
    const s = String(scopeKey || '');
    if (!s.endsWith('@g.us')) return { ok: false, reason: 'invalid' };
    const w = windows.get(s);
    if (!w || w.msgs.length < 5) return { ok: false, reason: 'insufficient' };

    const t = Number(now) || Date.now();
    const tokenCounts = new Map();
    let totalLen = 0;
    const emojiCounts = new Map();
    const sampleLines = [];

    for (const m of w.msgs) {
      const tokens = extractTokens(m.text);
      for (const tk of tokens) tokenCounts.set(tk, (tokenCounts.get(tk) || 0) + 1);
      totalLen += String(m.text).length;
      const em = extractEmojis(m.text);
      for (const e of em) emojiCounts.set(e, (emojiCounts.get(e) || 0) + 1);
    }

    const topTokens = [...tokenCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([w2]) => w2);
    const emojis = [...emojiCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([e, c]) => ({ emoji: e, count: c }));
    const avgLen = totalLen / w.msgs.length;

    for (const m of w.msgs.slice(-3)) sampleLines.push(anonymizeLine(m.text));

    const persisted = personaRepository.upsertProfile({
      scopeKey: s,
      topTokens,
      emojis,
      avgLen,
      styleLines: sampleLines,
      sampleTs: t,
      now: t,
    });
    if (persisted.ok) w.lastDeriveAt = t;
    return persisted;
  }

  /**
   * Versão com debounce do deriveAndPersistProfile, usada no fluxo real (por mensagem).
   * Só deriva quando a janela tem amostra suficiente e o intervalo mínimo passou.
   */
  function maybeDeriveProfile(scopeKey, funConfig = {}, now = Date.now()) {
    const s = String(scopeKey || '');
    if (!s.endsWith('@g.us')) return { ok: false, reason: 'invalid' };
    const w = windows.get(s);
    if (!w || w.msgs.length < 5) return { ok: false, reason: 'insufficient' };
    const t = Number(now) || Date.now();
    const intervalMs = opts(funConfig).deriveIntervalMs;
    if (w.lastDeriveAt && t - w.lastDeriveAt < intervalMs) return { ok: false, reason: 'debounced' };
    return deriveAndPersistProfile(s, funConfig, t);
  }

  function buildStyleBlock(scopeKey) {
    const profile = personaRepository.getProfile(scopeKey);
    if (!profile) return '';
    const parts = [];
    if (profile.topTokens?.length) parts.push(`Vocabulário frequente: ${profile.topTokens.join(', ')}.`);
    if (profile.emojis?.length) parts.push(`Emojis típicos: ${profile.emojis.map((e) => e.emoji).join(' ')}.`);
    if (profile.styleLines?.length) {
      parts.push(`Exemplos de tom (anonimizados):`);
      for (const l of profile.styleLines) parts.push(`- "${l}"`);
    }
    if (profile.avgLen > 0) parts.push(`Tamanho médio das mensagens: ~${Math.round(profile.avgLen)} chars.`);
    return parts.join('\n');
  }

  function buildSystemPrompt({ styleBlock, threadContext, maxChars }) {
    const parts = [
      'Você é um membro comum de um grupo de WhatsApp. Está respondendo naturalmente, como um participante qualquer — não como assistente.',
      'Escreva em português do Brasil, 1 a 3 frases curtas, no estilo de fala do grupo.',
      'Varie o tom: às vezes debochado, às vezes empático, às vezes breve.',
      'NUNCA mencione que é um bot, IA ou assistente.',
      'NUNCA mencione coins, XP, level, placar ou saldo — isso é proibido.',
      'NUNCA revele dados pessoais, nomes reais, números de telefone ou conteúdo privado.',
      'Responda ao conteúdo da mensagem citada, não repita folders.',
    ];
    if (styleBlock) {
      parts.push('');
      parts.push(`Estilo aprendido do grupo:\n${styleBlock}`);
    }
    if (threadContext?.length) {
      parts.push('');
      parts.push('Últimas trocas da conversa atual (para dar continuidade):');
      for (const turn of threadContext.slice(-4)) parts.push(`- ${turn.role || 'membro'}: "${turn.text || ''}"`);
    }
    parts.push('');
    parts.push(`Limite: até ${maxChars} caracteres. Responda só com a mensagem, sem preâmbulo.`);
    return parts.join('\n');
  }

  async function generateResponse({ text, scopeKey, funConfig, threadContext, responseContextPack, participantJids = [] }) {
    const o = opts(funConfig);
    const identityStyle = responseContextPack?.groupIdentity?.voiceStyle?.join(', ') || '';
    const socialHints = (personaSocialHintService?.getHints?.(scopeKey, participantJids, { limit: 6 }) || [])
      .filter((hint) => hint.socialSignal !== 'negative' && Number(hint.confidence) >= 60);
    const socialHintBlock = socialHints.length
      ? `Pistas sociais inferidas e incertas (não são fatos; não as declare como verdade):\n${socialHints.map((hint) => `- ${hint.hintText}`).join('\n')}`
      : '';
    const styleBlock = [buildStyleBlock(scopeKey), identityStyle, socialHintBlock].filter(Boolean).join('\n');
    const contextTurns = responseContextPack?.threadContext?.topicSummary
      ? [...(threadContext || []), { role: 'contexto', text: responseContextPack.threadContext.topicSummary }]
      : threadContext;
    const facts = responseContextPack?.confirmedFacts?.map((m) => m.factText).slice(0, 4) || [];
    const system = `${buildSystemPrompt({ styleBlock, threadContext: contextTurns, maxChars: o.maxChars })}${facts.length ? `\nFatos confirmados relevantes (não invente além deles):\n${facts.map((fact) => `- ${fact}`).join('\n')}` : ''}\nSinais inferidos são apenas pistas: jamais os apresente como fato.`;
    const prompt = String(text || '').slice(0, o.maxChars);

    if (process.env.FUN_DISABLE_LIVE_LLM === '1') return '';

    const zen = resolveZenTaskParams('persona', funConfig);
    try {
      const raw = await openaiChatComplete({
        baseUrl: funConfig.zenBaseUrl,
        model: funConfig.zenModel,
        prompt,
        system,
        timeoutMs: Math.min(o.timeoutMs, zen.timeoutMs || 15_000),
        maxTokens: zen.maxTokens,
        temperature: zen.temperature,
        apiKey: funConfig.zenApiKey || '',
        sendSamplingParams: funConfig.zenSendSamplingParams !== false,
      });
      if (!raw) return '';
      const clean = sanitizeFlavor(raw, o.maxChars);
      if (!clean || looksLikeScoreboardEcho(clean)) return '';
      return clean.slice(0, o.maxChars);
    } catch (err) {
      logger?.warn?.('[personaService] geração LLM falhou: %s', String(err?.message || err));
      return '';
    }
  }

  function fallbackResponse(rotationIndex) {
    return pickRotation(rotationIndex || 0, FALLBACK_LINES);
  }

  async function tryRespond(ctx = {}) {
    try {
      const o = opts(ctx.funConfig);
      if (!o.enabled) return { responded: false, reason: 'disabled-global' };

      const scopeKey = String(ctx.scopeKey || '');
      if (!scopeKey.endsWith('@g.us')) return { responded: false, reason: 'invalid' };

      const settings = ctx.groupSettings || groupRepository.getGroupSettings(scopeKey);
      if (settings?.personaEnabled === false) return { responded: false, reason: 'disabled-group' };
      if (!isGroupMessage(ctx)) return { responded: false, reason: 'not-group' };

      const botJids = collectBotJids(ctx.sock, ctx.identityMap);
      const authorRaw = normalizeJid(ctx.authorJid);
      const authorJid = resolveJid(authorRaw, ctx.identityMap);
      if (botJids.has(authorRaw) || botJids.has(authorJid)) return { responded: false, reason: 'self-loop' };

      const now = Number(ctx.now) || Date.now();
      if (!isTextMessage(ctx.messageType)) return { responded: false, reason: 'message-type' };
      if (inFlightScopes.has(scopeKey)) return { responded: false, reason: 'in-flight' };

      const { mention, atMention } = detectTrigger({
        text: ctx.text,
        mentionedJids: ctx.mentionedJids,
        botJids: [...botJids],
        identityMap: ctx.identityMap,
      });

      const quotedRaw = normalizeJid(ctx.quotedParticipant);
      const quotedIsBot = botJids.has(quotedRaw) || botJids.has(resolveJid(quotedRaw, ctx.identityMap));

      let thread = personaRepository.getActiveThread(scopeKey, { now, ttlMs: o.threadTtlMs });
      const isContinuation = !mention && !atMention && quotedIsBot && thread;
      if (!mention && !atMention && !isContinuation) return { responded: false, reason: 'no-trigger' };
      if (!isContinuation && isInCooldown(scopeKey, now, o.cooldownMs)) return { responded: false, reason: 'cooldown' };
      if (isContinuation && thread && thread.turnCount >= thread.maxTurns) return { responded: false, reason: 'thread-limit' };

      let threadContext = [];
      if (thread?.context?.length) threadContext = thread.context;

      inFlightScopes.add(scopeKey);
      let response = await generateResponse({
        text: ctx.text,
        scopeKey,
        funConfig: ctx.funConfig,
        threadContext,
        responseContextPack: ctx.responseContextPack,
        participantJids: [authorJid, ...(ctx.mentionedJids || []), quotedRaw].filter(Boolean),
      });
      let usedFallback = false;
      if (!response) {
        response = fallbackResponse(now);
        usedFallback = true;
      }

      const sentMessage = ctx.sock?.sendMessage && typeof ctx.sock.sendMessage === 'function'
        ? await ctx.sock.sendMessage(scopeKey, { text: response })
        : null;
      const responseMessageId = String(sentMessage?.key?.id || '');

      setCooldown(scopeKey, now);

      if (isContinuation && thread) {
        const cont = personaRepository.continueThread({
          threadId: thread.id,
          context: [
            ...threadContext,
            { role: 'membro', text: String(ctx.text || '').slice(0, 200) },
            { role: 'bot', text: response.slice(0, 200) },
          ],
          now,
        });
        if (!cont?.ok) logger?.debug?.('[personaService] continueThread falhou: %s', cont?.reason || '?');
      } else {
        thread = personaRepository.openThread({
          scopeKey,
          maxTurns: o.maxTurns,
          context: [
            { role: 'membro', text: String(ctx.text || '').slice(0, 200) },
            { role: 'bot', text: response.slice(0, 200) },
          ],
          now,
        });
      }

      const threadKey = String(ctx.responseContextPack?.threadContext?.threadKey || '');
      if (responseMessageId && threadKey) {
        threadContextService?.anchorResponse?.({
          scopeKey,
          threadKey,
          anchorMessageId: responseMessageId,
          now,
        });
      }

      return { responded: true, response, usedFallback, threadId: thread?.id || 0 };
    } catch (err) {
      logger?.warn?.('[personaService] tryRespond erro: %s', String(err?.message || err));
      return { responded: false, reason: 'error' };
    } finally {
      const sk = String(ctx.scopeKey || '');
      if (sk) inFlightScopes.delete(sk);
    }
  }

  return {
    tryRespond,
    observeMessage,
    deriveAndPersistProfile,
    maybeDeriveProfile,
    detectTrigger,
    isInCooldown,
    buildStyleBlock,
    buildSystemPrompt,
    generateResponse,
    fallbackResponse,
    _cooldowns: cooldowns,
    _inFlightScopes: inFlightScopes,
    _windows: windows,
    _opts: opts,
  };
}

function isGroupMessage(ctx) {
  return Boolean(ctx.scopeKey && String(ctx.scopeKey).endsWith('@g.us'));
}
