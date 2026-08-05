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
import { resolveZenEndpoint } from '../llm/zenEndpoint.js';
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
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
    .map(normalizeToken)
    .filter((w) => w.length >= 3);
  return words;
}

function extractEmojis(text) {
  const matches = String(text || '').match(EMOJI_RE);
  return matches || [];
}

const LAUGH_ONLY_RE = /^k+$/i;
const REPEAT_RE = /(.)\1{3,}/g;
const TONE_CMD_RE = /^\s*(?:[/!])/;
const TONE_URL_RE = /(?:https?:\/\/|www\.)/i;

function normalizeToken(token) {
  const t = String(token || '');
  if (LAUGH_ONLY_RE.test(t)) return 'kkk';
  return t.replace(REPEAT_RE, '$1$1');
}

function toneScore(line) {
  let score = 0;
  const len = line.length;
  if (len >= 6 && len <= 60) score += 1;
  if (/[!?…]/.test(line)) score += 1;
  if (/[aeiouàáâãéêíóôõú]/i.test(line)) score += 1;
  score += Math.min(2, (line.match(/\bk+\b/gi) || []).length);
  if (/[A-Z]{2,}/.test(line)) score += 1;
  return score;
}

function isNoiseToneLine(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed) return true;
  if (TONE_CMD_RE.test(trimmed)) return true;
  if (TONE_URL_RE.test(trimmed)) return true;
  if (/^[k\s!?.,]+$/i.test(trimmed)) return true;
  return false;
}

function pickToneSamples(msgs, count = 4) {
  const seen = new Set();
  const candidates = [];
  for (const m of msgs) {
    const text = String(m?.text || '').trim();
    if (!text || seen.has(text) || isNoiseToneLine(text)) continue;
    seen.add(text);
    candidates.push({ text, userJid: String(m.userJid || ''), score: toneScore(text) });
  }
  candidates.sort((a, b) => b.score - a.score || (a.text < b.text ? -1 : 1));
  const chosen = [];
  const authors = new Set();
  for (const c of candidates) {
    if (chosen.length >= count) break;
    if (authors.has(c.userJid)) continue;
    authors.add(c.userJid);
    chosen.push(c);
  }
  for (const c of candidates) {
    if (chosen.length >= count) break;
    if (chosen.includes(c)) continue;
    chosen.push(c);
  }
  return chosen.map((c) => anonymizeLine(c.text));
}

function buildToneBlock(identity) {
  const allowed = Array.isArray(identity?.allowedTones) && identity.allowedTones.length
    ? identity.allowedTones.join(', ')
    : '';
  const forbidden = Array.isArray(identity?.forbiddenTones) && identity.forbiddenTones.length
    ? identity.forbiddenTones.join(', ')
    : '';
  const parts = [
    'Humor: acompanhe a zoação do grupo — se a galera é ácida/debochada, seja ácido na medida deles (é normal no Brasil), sem passar dos limites do que o próprio grupo aceita.',
  ];
  if (allowed) parts.push(`Tom de base do grupo: ${allowed} (mas a zoeira pode subir de tom quando o assunto pedir).`);
  if (forbidden) parts.push(`Evite soar: ${forbidden}.`);
  return parts.join(' ');
}

function pickRotation(i, arr) {
  if (!arr.length) return '';
  return arr[i % arr.length];
}

function cleanPromptText(value, maxChars = 500) {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim().slice(0, maxChars);
}

function memorySignalText(signal) {
  if (!signal || typeof signal !== 'object') return '';
  if (Array.isArray(signal.riskFlags) && signal.riskFlags.length) return '';
  return cleanPromptText(signal.factText || signal.summary || signal.text, 220);
}

export function createPersonaService({
  personaRepository,
  groupRepository,
  threadContextService = null,
  personaSocialHintService = null,
  profileService = null,
  generateZen = openaiChatComplete,
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
      maxChars: Number(funConfig.personaMaxChars) || 280,
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
      const cmdPrefix = String(funConfig.prefix || '/');
      if (cmdPrefix && body.startsWith(cmdPrefix)) return { observed: false, reason: 'command' };

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

    for (const m of w.msgs) {
      const seenTokens = new Set(extractTokens(m.text));
      for (const tk of seenTokens) tokenCounts.set(tk, (tokenCounts.get(tk) || 0) + 1);
      totalLen += String(m.text).length;
      const em = extractEmojis(m.text);
      for (const e of em) emojiCounts.set(e, (emojiCounts.get(e) || 0) + 1);
    }

    const topTokens = [...tokenCounts.entries()]
      .filter(([, c]) => c >= 2)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 30)
      .map(([w2]) => w2);
    const emojis = [...emojiCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([e, c]) => ({ emoji: e, count: c }));
    const avgLen = totalLen / w.msgs.length;
    const styleLines = pickToneSamples(w.msgs);

    const persisted = personaRepository.upsertProfile({
      scopeKey: s,
      topTokens,
      emojis,
      avgLen,
      styleLines,
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
    if (profile.avgLen > 0) parts.push(`Tamanho médio das mensagens: ~${Math.round(profile.avgLen)} chars (use como referência de ritmo, não de tamanho — desenvolva a resposta).`);
    return parts.join('\n');
  }

  function buildSystemPrompt({ styleBlock, threadContext, maxChars }) {
    const parts = [
      'Você é um membro comum de um grupo de WhatsApp. Está respondendo naturalmente, como um participante qualquer — não como assistente.',
      'Você É o "bot" do grupo: quando alguém chama "bot" ou te marca, é com você. Fale SEMPRE em primeira pessoa (eu, meu, minha) — jamais se refira a si mesmo como "o bot", "esse bot", "a máquina" ou pelo seu nome.',
      'Escreva em português do Brasil, 1 a 4 frases completas, no estilo de fala do grupo.',
      'Varie o tom: às vezes debochado, às vezes empático, às vezes breve.',
      `Comprimento: desenvolva a resposta em ${Math.min(80, Math.max(40, Math.round(maxChars * 0.4)))} a ${maxChars} caracteres — não responda a cada assunto com uma frase seca, mas também não vire um texto.`,
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

  async function generateResponse({
    text,
    scopeKey,
    funConfig,
    threadContext,
    responseContextPack,
    participantJids = [],
    authorLabel = '',
    quotedText = '',
  }) {
    const o = opts(funConfig);
    const groupIdentity = responseContextPack?.groupIdentity || {};
    const identityStyle = (groupIdentity.voiceStyle || []).filter(Boolean).join(', ') || '';
    const toneBlock = buildToneBlock(groupIdentity);
    const lore = cleanPromptText(groupIdentity.groupLoreSummary, 800);
    const loreBlock = lore ? `Contexto do grupo (lore extraída dos fatos):\n${lore}` : '';
    const identityBlock = profileService?.buildIdentityBlock
      ? profileService.buildIdentityBlock(scopeKey, participantJids, funConfig)
      : '';
    const socialHints = (personaSocialHintService?.getHints?.(scopeKey, participantJids, { limit: 6 }) || [])
      .filter((hint) => hint.socialSignal !== 'negative' && Number(hint.confidence) >= 60);
    const socialHintBlock = socialHints.length
      ? `Pistas sociais inferidas e incertas (não são fatos; não as declare como verdade):\n${socialHints.map((hint) => `- ${hint.hintText}`).join('\n')}`
      : '';
    const contextHasRisk = Array.isArray(responseContextPack?.riskFlags) && responseContextPack.riskFlags.length > 0;
    const inferredSignals = contextHasRisk
      ? []
      : (responseContextPack?.inferredSignals || []).map(memorySignalText).filter(Boolean).slice(0, 4);
    const socialSignals = contextHasRisk
      ? []
      : (responseContextPack?.socialSignals || []).map(memorySignalText).filter(Boolean).slice(0, 4);
    const inferredBlock = [...inferredSignals, ...socialSignals].length
      ? `Pistas de memória incertas (use apenas para calibrar a resposta; nunca afirme como fato):\n${[...inferredSignals, ...socialSignals].map((signal) => `- ${signal}`).join('\n')}`
      : '';
    const styleBlock = [
      buildStyleBlock(scopeKey),
      identityStyle ? `Voz observada do grupo: ${identityStyle}.` : '',
      toneBlock,
      loreBlock,
      identityBlock,
      socialHintBlock,
      inferredBlock,
    ].filter(Boolean).join('\n');
    const contextTurns = responseContextPack?.threadContext?.topicSummary
      ? [...(threadContext || []), { role: 'contexto', text: responseContextPack.threadContext.topicSummary }]
      : threadContext;
    const facts = responseContextPack?.confirmedFacts?.map((m) => cleanPromptText(m.factText, 220)).filter(Boolean).slice(0, 4) || [];
    const system = [
      buildSystemPrompt({ styleBlock, threadContext: contextTurns, maxChars: o.maxChars }),
      facts.length ? `Fatos confirmados relevantes (não invente além deles):\n${facts.map((fact) => `- ${fact}`).join('\n')}` : '',
      'Sinais inferidos são apenas pistas: jamais os apresente como fato.',
    ].filter(Boolean).join('\n');
    const author = cleanPromptText(authorLabel, 80) || 'membro';
    const quoted = cleanPromptText(quotedText, 500);
    const prompt = [
      `[${author}]: ${cleanPromptText(text, o.maxChars)}`,
      quoted ? `Em resposta a: "${quoted}"` : '',
    ].filter(Boolean).join('\n\n');

    if (process.env.FUN_DISABLE_LIVE_LLM === '1') return '';

    const zen = resolveZenTaskParams('persona', funConfig);
    const ep = resolveZenEndpoint(funConfig);
    const retries = Number(funConfig?.zenMaxRetries);
    const totalTries = Math.max(1, Math.min(8, Number.isFinite(retries) ? Math.floor(retries) + 1 : 4));
    for (let attempt = 1; attempt <= totalTries; attempt += 1) {
      try {
        const raw = await generateZen({
          baseUrl: ep.baseUrl,
          model: ep.model,
          prompt,
          system,
          timeoutMs: Math.min(o.timeoutMs, zen.timeoutMs || 15_000),
          maxTokens: zen.maxTokens,
          temperature: zen.temperature,
          apiKey: ep.apiKey,
          sendSamplingParams: funConfig.zenSendSamplingParams !== false,
        });
        const clean = sanitizeFlavor(raw, o.maxChars);
        if (clean && !looksLikeScoreboardEcho(clean)) return clean.slice(0, o.maxChars);
        logger?.debug?.('[personaService] geração LLM vazia/inválida (tentativa %d/%d)', attempt, totalTries);
      } catch (err) {
        logger?.warn?.('[personaService] geração LLM falhou (tentativa %d/%d): %s', attempt, totalTries, String(err?.message || err));
      }
    }
    return '';
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

      const participantJids = [authorJid, ...(ctx.mentionedJids || []), quotedRaw].filter(Boolean);
      const authorLabel = profileService?.displayName
        ? profileService.displayName(authorJid, scopeKey)
        : authorJid.split('@')[0] || 'membro';

      inFlightScopes.add(scopeKey);
      let response = await generateResponse({
        text: ctx.text,
        scopeKey,
        funConfig: ctx.funConfig,
        threadContext,
        responseContextPack: ctx.responseContextPack,
        participantJids,
        authorLabel,
        quotedText: ctx.quotedText,
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
