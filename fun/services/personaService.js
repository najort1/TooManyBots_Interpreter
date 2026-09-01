/**
 * Persona (Bot Membro Vivo) — o bot responde como membro comum do grupo
 * quando citado como "bot" (palavra inteira), apelidos ou marcado via @.
 *
 * Camada de serviço orquestradora:
 * - Detecção de gatilho e guardas (cooldown, anti-self-loop, toggle por grupo).
 * - Gestão de threads de conversa e ancoragem de respostas.
 * - Aprendizado de estilo (janela rolante em memória + perfil persistido).
 * - Geração de resposta via Zen com suporte agêntico HÍBRIDO (multi-bubble / stickers / tools).
 * - Despachante com Human Pacing (timing natural entre balões e mídias).
 *
 * Módulos especializados integrados (Clean Code / SRP):
 * - `personaPromptBuilder.js`: Composição do System Prompt, User Prompt e blocos de contexto.
 * - `personaTriggerDetector.js`: Detecção avançada de gatilhos, apelidos e continuações.
 * - `personaStyleDeriver.js`: Extração estatística de vocabulário, emojis e decaimento.
 * - `personaStickerCatalog.js`: Resolução de figurinhas exclusivas do bot.
 */

import { readFileSync } from 'node:fs';
import { randomUUID } from 'crypto';
import { sanitizeFlavor, looksLikeScoreboardEcho } from '../llm/flavorService.js';
import { openaiChatComplete } from '../llm/openaiClient.js';
import { resolveZenEndpoint } from '../llm/zenEndpoint.js';
import { resolveZenTaskParams } from '../llm/zenTaskParams.js';
import { PERSONA_CONTEXT_TURNS, PERSONA_DERIVE_INTERVAL_MS, PERSONA_TOKEN_HALF_LIFE_MS, PERSONA_TOP_TOKENS } from '../constants.js';
import { buildPersonaToolManifest, parsePersonaEnvelope, looksLikeRawJson } from './personaToolProtocol.js';
import { isUsablePromptFact } from '../utils/promptFactSanitizer.js';
import { buildFactTemporalContext, formatDatedFact } from '../utils/factTemporalContext.js';
import { resolveStickerPath } from './personaStickerCatalog.js';
import { imageBufferToSticker } from '../utils/stickerConvert.js';
import { resolveMediaFromRawMessage, downloadResolvedMedia } from '../utils/mediaDownload.js';
import {
  cleanPromptText,
  buildTemporalBlock,
  buildToneBlock,
  buildPersonaSystemPrompt,
  buildPersonaUserPrompt,
  buildSocialHintBlock,
  memorySignalText,
} from './personaPromptBuilder.js';
import { resolveMentionsInText } from '../utils/mentionResolver.js';
import {
  normalizeJid,
  resolveJid,
  collectBotJids,
  normalizeAnchorText,
  isTextMessage,
  detectTrigger as detectTriggerInternal,
  isThreadContinuation,
} from './personaTriggerDetector.js';
import {
  deriveGroupStyle,
} from './personaStyleDeriver.js';

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

function pickRotation(i, arr) {
  if (!arr.length) return '';
  return arr[i % arr.length];
}

/**
 * Turno de thread de um membro.
 */
function memberTurn(authorLabel, text) {
  const name = String(authorLabel || '').replace(/[\r\n]+/g, ' ').trim();
  return { role: 'membro', ...(name ? { name } : {}), text: String(text || '') };
}

function sleep(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createPersonaService({
  personaRepository,
  groupRepository,
  threadContextService = null,
  personaSocialHintService = null,
  profileService = null,
  personaToolExecutor = null,
  generateZen = openaiChatComplete,
  getLogger = () => null,
  random = Math.random,
  adapters = {},
  promptContextBuilder = null,
} = {}) {
  if (!personaRepository) throw new Error('[fun/personaService] personaRepository required');
  if (!groupRepository) throw new Error('[fun/personaService] groupRepository required');

  const effectivePromptContextBuilder = promptContextBuilder || adapters.promptContextBuilder || null;

  const logger = getLogger();

  /** @type {Map<string, number>} */
  const cooldowns = new Map();
  /** @type {Set<string>} */
  const inFlightScopes = new Set();
  /** @type {Map<string, { msgs: Array<{ userJid: string, text: string, at: number }>, updatedAt: number, lastDeriveAt?: number, accTokenCounts?: Map<string, number>, accAvgLen?: number }>} */
  const windows = new Map();

  function opts(funConfig = {}) {
    return {
      enabled: funConfig.personaEnabled !== false,
      cooldownMs: Number(funConfig.personaCooldownMs) || 0,
      maxTurns: Number(funConfig.personaMaxTurns) || 0,
      threadTtlMs: Number(funConfig.personaThreadTtlMs) || 30 * 60_000,
      windowSize: Number(funConfig.personaWindowSize) || 100,
      windowMs: Number(funConfig.personaWindowMs) || 24 * 60 * 60 * 1000,
      timeoutMs: Number(funConfig.personaTimeoutMs) || 15_000,
      maxChars: Number(funConfig.personaMaxChars) || 280,
      deriveIntervalMs: Number(funConfig.personaDeriveIntervalMs) || PERSONA_DERIVE_INTERVAL_MS,
      tokenHalfLifeMs: Number(funConfig.personaTokenHalfLifeMs) || PERSONA_TOKEN_HALF_LIFE_MS,
      topTokens: Number(funConfig.personaTopTokens) || PERSONA_TOP_TOKENS,
      contextTurns: Number(funConfig.personaContextTurns) || PERSONA_CONTEXT_TURNS,
      personaSocialHintsMinConfidence: Number(funConfig.personaSocialHintsMinConfidence) || 45,
      timezone: String(funConfig.personaTimezone || funConfig.worldTimezone || 'America/Sao_Paulo'),
      customAliases: Array.isArray(funConfig.personaCustomAliases) ? funConfig.personaCustomAliases : [],
      allowNaturalMentions: Boolean(funConfig.personaNaturalMentions),
    };
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
    const o = opts(funConfig);

    const halfLifeMs = Math.max(60_000, Number(o.tokenHalfLifeMs) || PERSONA_TOKEN_HALF_LIFE_MS);
    let prevCounts = w.accTokenCounts;
    let prevAvgLen = w.accAvgLen || 0;

    if (!prevCounts) {
      const existing = personaRepository.getProfile(s);
      if (existing?.tokenCounts && typeof existing.tokenCounts === 'object') {
        prevCounts = new Map(Object.entries(existing.tokenCounts).map(([k, v]) => [k, Number(v) || 0]));
      } else {
        prevCounts = new Map();
      }
      prevAvgLen = Number(existing?.avgLen) || 0;
    }

    const dtRaw = w.lastDeriveAt != null ? t - Number(w.lastDeriveAt) : 0;
    const dt = Number.isFinite(dtRaw) && dtRaw > 0 ? dtRaw : 0;

    const derived = deriveGroupStyle({
      msgs: w.msgs,
      prevCounts,
      prevAvgLen,
      dtMs: dt,
      halfLifeMs,
      topTokensCap: Math.max(10, Math.min(120, Number(o.topTokens) || PERSONA_TOP_TOKENS)),
    });

    const persisted = personaRepository.upsertProfile({
      scopeKey: s,
      topTokens: derived.topTokens,
      emojis: derived.emojis,
      avgLen: derived.avgLen,
      styleLines: derived.styleLines,
      sampleTs: t,
      now: t,
      tokenCounts: Object.fromEntries(derived.tokenCounts.entries()),
    });

    if (persisted.ok) {
      w.lastDeriveAt = t;
      w.accTokenCounts = derived.tokenCounts;
      w.accAvgLen = derived.avgLen;
    }
    return persisted;
  }

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

  function buildSystemPrompt({ styleBlock, threadContext, maxChars, contextTurns }) {
    return buildPersonaSystemPrompt({
      styleBlock,
      threadContext,
      maxChars,
      contextTurns,
    });
  }

  async function generateResponse({
    text,
    images = [],
    scopeKey,
    funConfig,
    threadContext,
    responseContextPack,
    participantJids = [],
    authorLabel = '',
    quotedText = '',
    agentContext = null,
  }) {
    const o = opts(funConfig);
    const groupIdentity = responseContextPack?.groupIdentity || {};
    const identityStyle = (groupIdentity.voiceStyle || []).filter(Boolean).join(', ') || '';
    const toneBlock = buildToneBlock(groupIdentity);
    const lore = String(groupIdentity.groupLoreSummary || '').trim();
    const loreBlock = lore ? `Contexto do grupo (lore extraída dos fatos):\n${lore}` : '';
    const identityBlock = profileService?.buildIdentityBlock
      ? profileService.buildIdentityBlock(scopeKey, participantJids, funConfig)
      : '';

    const loadedHints = personaSocialHintService?.getHints?.(scopeKey, { limit: 90 }) || [];
    const socialHintBlock = buildSocialHintBlock(loadedHints, o.personaSocialHintsMinConfidence);

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

    const authorJid = agentContext?.authorJid || '';
    const authorProfile = authorJid && profileService?.getProfile
      ? profileService.getProfile(authorJid, scopeKey)
      : null;

    const extraContextBlock = effectivePromptContextBuilder
      ? effectivePromptContextBuilder({
          scopeKey,
          authorJid,
          authorProfile,
          groupIdentity,
          activePersonaSummary: lore,
          confirmedFacts: responseContextPack?.confirmedFacts || [],
          mentionedJids: agentContext?.mentionedJids || [],
          getDisplayName: profileService?.displayName
            ? (jid) => profileService.displayName(jid, scopeKey)
            : null,
          getProfile: profileService?.getProfile
            ? (jid) => profileService.getProfile(jid, scopeKey)
            : null,
          loreFacts: responseContextPack?.loreFacts || [],
          timeZone: o.timezone,
        })
      : '';

    const styleBlock = [
      buildStyleBlock(scopeKey),
      identityStyle ? `Voz observada do grupo: ${identityStyle}.` : '',
      toneBlock,
      loreBlock,
      identityBlock,
      socialHintBlock,
      inferredBlock,
      extraContextBlock,
    ].filter(Boolean).join('\n');

    const contextTurns = responseContextPack?.threadContext?.topicSummary
      ? [...(threadContext || []), { role: 'contexto', text: responseContextPack.threadContext.topicSummary }]
      : threadContext;

    const currentNow = Number(agentContext?.now) || Date.now();
    const facts = (responseContextPack?.confirmedFacts || [])
      .map((memory) => {
        const text = cleanPromptText(memory.factText, Infinity);
        if (!text || !isUsablePromptFact(text)) return '';
        return formatDatedFact(memory, text, o.timezone);
      })
      .filter(Boolean);

    const system = [
      buildPersonaSystemPrompt({ styleBlock, threadContext: contextTurns, maxChars: o.maxChars, contextTurns: o.contextTurns }),
      buildTemporalBlock(currentNow, o.timezone),
      buildFactTemporalContext({ now: currentNow, timeZone: o.timezone }),
      facts.length ? `Fatos confirmados relevantes (não invente além deles):\n${facts.map((fact) => `- ${fact}`).join('\n')}` : '',
      'Sinais inferidos são apenas pistas: jamais os apresente como fato.',
    ].filter(Boolean).join('\n');

    const prompt = buildPersonaUserPrompt({
      text,
      authorLabel,
      quotedText,
      maxChars: o.maxChars,
    });

    if (process.env.FUN_DISABLE_LIVE_LLM === '1') return '';

    const zen = resolveZenTaskParams('persona', funConfig);
    const ep = resolveZenEndpoint(funConfig);
    const retries = Number(funConfig?.zenMaxRetries);
    const totalTries = Math.max(1, Math.min(8, Number.isFinite(retries) ? Math.floor(retries) + 1 : 4));

    for (let attempt = 1; attempt <= totalTries; attempt += 1) {
      try {
        const agentEnabled = Boolean(personaToolExecutor && funConfig?.personaToolsEnabled !== false);
        const raw = await generateZen({
          baseUrl: ep.baseUrl,
          model: ep.model,
          prompt,
          images,
          system: agentEnabled ? `${system}\n\n${buildPersonaToolManifest()}` : system,
          timeoutMs: Math.min(o.timeoutMs, zen.timeoutMs || 15_000),
          maxTokens: zen.maxTokens,
          temperature: zen.temperature,
          apiKey: ep.apiKey,
          sendSamplingParams: funConfig?.zenSendSamplingParams !== false,
          jsonMode: agentEnabled,
          jsonOnly: agentEnabled,
        });

        if (agentEnabled) {
          const decision = parsePersonaEnvelope(raw, { maxChars: o.maxChars });

          // Caso 1: Multi-Ação (Multi-Bubble / Sticker / React)
          if (decision.ok && decision.envelope.type === 'actions') {
            const combinedText = decision.envelope.actions
              .filter((a) => a.type === 'text')
              .map((a) => sanitizeFlavor(a.text, o.maxChars))
              .filter(Boolean)
              .join('\n\n');
            return {
              text: combinedText || '👍',
              actions: decision.envelope.actions,
            };
          }

          // Caso 2: Reply Direto
          if (decision.ok && decision.envelope.type === 'reply') {
            const direct = sanitizeFlavor(decision.envelope.text, o.maxChars);
            if (direct && !looksLikeScoreboardEcho(direct)) {
              return {
                text: direct.slice(0, o.maxChars),
                actions: [{ type: 'text', text: direct.slice(0, o.maxChars) }],
              };
            }
          }

          // Caso 3: Execução de Ferramenta + Follow-up
          if (decision.ok && decision.envelope.type === 'tool_call') {
            const toolResult = await personaToolExecutor.execute(decision.envelope, {
              ...agentContext,
              scopeKey,
              text,
              funConfig,
              now: Number(agentContext?.now) || Date.now(),
            });
            const resultText = cleanPromptText(toolResult?.text, Math.max(300, o.maxChars * 3));
            const resultSummary = cleanPromptText(toolResult?.summary || resultText || `Ferramenta ${decision.envelope.name} executada.`, Math.max(300, o.maxChars * 3));
            let followUp = '';
            let followUpActions = [];

            try {
              const finalRaw = await generateZen({
                baseUrl: ep.baseUrl,
                model: ep.model,
                prompt: `${prompt}\n\nResultado seguro da ação:\n${resultSummary}\n\nResponda com uma fala natural ou sequência multi-ação ("actions" ou "reply"), sem repetir o bloco acima.`,
                system: `${system}\n\nA ação já foi validada pelo servidor. Responda SOMENTE JSON: {"type":"actions","actions":[...]} ou {"type":"reply","text":"..."}. Não chame ferramenta.`,
                timeoutMs: Math.min(o.timeoutMs, zen.timeoutMs || 15_000),
                maxTokens: zen.maxTokens,
                temperature: zen.temperature,
                apiKey: ep.apiKey,
                sendSamplingParams: funConfig.zenSendSamplingParams !== false,
                jsonMode: true,
                jsonOnly: true,
              });
              const finalEnvelope = parsePersonaEnvelope(finalRaw, { maxChars: o.maxChars });
              if (finalEnvelope.ok && finalEnvelope.envelope.type === 'actions') {
                followUpActions = finalEnvelope.envelope.actions;
                followUp = followUpActions.filter((a) => a.type === 'text').map((a) => sanitizeFlavor(a.text, o.maxChars)).join('\n\n');
              } else if (finalEnvelope.ok && finalEnvelope.envelope.type === 'reply') {
                followUp = sanitizeFlavor(finalEnvelope.envelope.text, o.maxChars);
                followUpActions = [{ type: 'text', text: followUp }];
              } else {
                followUp = sanitizeFlavor(finalRaw, o.maxChars);
                followUpActions = [{ type: 'text', text: followUp }];
              }
            } catch (err) {
              logger?.debug?.('[personaService] fala pós-tool falhou: %s', String(err?.message || err));
            }

            const combined = [resultText, followUp].filter(Boolean).join('\n\n').slice(0, Math.max(o.maxChars, 1_600));
            // No modo tool_call simples com follow-up textual, preservamos o envio consolidado
            // para manter 100% de coerência com ferramentas de status/caos/oráculo.
            return {
              text: combined,
              actions: [{ type: 'text', text: combined }, ...followUpActions.filter((a) => a.type !== 'text')],
            };
          }

          const legacy = sanitizeFlavor(raw, o.maxChars);
          if (legacy && !looksLikeScoreboardEcho(legacy) && !looksLikeRawJson(legacy)) {
            return {
              text: legacy.slice(0, o.maxChars),
              actions: [{ type: 'text', text: legacy.slice(0, o.maxChars) }],
            };
          }
        }

        const clean = sanitizeFlavor(raw, o.maxChars);
        if (clean && !looksLikeScoreboardEcho(clean) && !looksLikeRawJson(clean)) {
          return {
            text: clean.slice(0, o.maxChars),
            actions: [{ type: 'text', text: clean.slice(0, o.maxChars) }],
          };
        }
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

  /**
   * Compõe uma fala autônoma e texto-apenas da persona. Serviços de domínio usam
   * esta API para anúncios factuais sem simular uma mensagem de membro, abrir
   * thread, disparar ferramentas ou enviar diretamente ao WhatsApp.
   */
  async function composeSystemAnnouncement({ scopeKey, kind = 'announcement', data = {}, funConfig = {}, now = Date.now() } = {}) {
    const o = opts(funConfig);
    const scope = String(scopeKey || '').trim();
    if (!o.enabled) return { ok: false, reason: 'disabled-global' };
    if (!scope.endsWith('@g.us')) return { ok: false, reason: 'invalid' };
    const settings = groupRepository.getGroupSettings(scope);
    if (settings?.personaEnabled === false) return { ok: false, reason: 'disabled-group' };

    const facts = Object.entries(data && typeof data === 'object' ? data : {})
      .filter(([, value]) => value !== '' && value !== null && value !== undefined)
      .map(([key, value]) => {
        const rendered = Array.isArray(value) ? value.join(', ') : String(value);
        return `- ${key}: ${cleanPromptText(rendered, 300)}`;
      })
      .filter(Boolean)
      .slice(0, 12);
    if (!facts.length) return { ok: false, reason: 'empty-data' };

    const styleBlock = buildStyleBlock(scope);
    const system = [
      'Você é um membro natural deste grupo de WhatsApp. Escreva um lembrete curto, caloroso e informal em pt-BR.',
      'Use somente os fatos fornecidos. Não invente detalhes, não faça perguntas e não use JSON, markdown de sistema, ferramentas, stickers ou reações.',
      'Não diga que é IA, sistema ou automação. Produza uma única mensagem de até 420 caracteres.',
      styleBlock ? `Voz observada do grupo:\n${styleBlock}` : '',
      buildTemporalBlock(Number(now) || Date.now(), o.timezone),
    ].filter(Boolean).join('\n\n');
    const prompt = [
      `Tipo de anúncio: ${cleanPromptText(kind, 80)}.`,
      'Fatos confirmados:',
      ...facts,
      'Escreva agora apenas a mensagem que será enviada ao grupo.',
    ].join('\n');

    if (process.env.FUN_DISABLE_LIVE_LLM === '1' || funConfig.zenEnabled === false) {
      return { ok: false, reason: 'llm-disabled' };
    }

    const zen = resolveZenTaskParams('persona', funConfig);
    const endpoint = resolveZenEndpoint(funConfig);
    try {
      const raw = await generateZen({
        baseUrl: endpoint.baseUrl,
        model: endpoint.model,
        apiKey: endpoint.apiKey,
        system,
        prompt,
        timeoutMs: Math.min(o.timeoutMs, zen.timeoutMs || o.timeoutMs),
        maxTokens: zen.maxTokens,
        temperature: zen.temperature,
        sendSamplingParams: funConfig.zenSendSamplingParams !== false,
      });
      const announcement = sanitizeFlavor(raw, Math.min(420, Math.max(80, o.maxChars + 140)));
      if (!announcement || looksLikeRawJson(announcement) || looksLikeScoreboardEcho(announcement)) {
        return { ok: false, reason: 'invalid-generation' };
      }
      return { ok: true, text: announcement, usedFallback: false };
    } catch (error) {
      logger?.debug?.('[personaService] anúncio autônomo falhou: %s', String(error?.message || error));
      return { ok: false, reason: 'generation-error' };
    }
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
      const rawMsg = ctx.rawMessage || ctx.quoteSource;
      const mediaResolution = rawMsg ? resolveMediaFromRawMessage(rawMsg) : null;
      const hasImageMedia = mediaResolution?.media?.kind === 'image' || mediaResolution?.media?.messageType === 'image' || mediaResolution?.media?.messageType === 'document-image';
      const isEligibleMessageType = isTextMessage(ctx.messageType) || ctx.messageType === 'image' || ctx.messageType === 'album' || hasImageMedia;

      if (!isEligibleMessageType) return { responded: false, reason: 'message-type' };
      if (inFlightScopes.has(scopeKey)) return { responded: false, reason: 'in-flight' };

      const { mention, atMention } = detectTriggerInternal({
        text: ctx.text,
        mentionedJids: ctx.mentionedJids,
        botJids: [...botJids],
        identityMap: ctx.identityMap,
        customAliases: o.customAliases,
        allowNaturalMentions: o.allowNaturalMentions,
      });

      const quotedRaw = normalizeJid(ctx.quotedParticipant);
      const quotedIsBot = botJids.has(quotedRaw) || botJids.has(resolveJid(quotedRaw, ctx.identityMap));

      let thread = personaRepository.getActiveThread(scopeKey, { now, ttlMs: o.threadTtlMs });
      const isContinuation = !mention && !atMention && isThreadContinuation({
        quotedIsBot,
        thread,
        quotedMessageId: ctx.quotedMessageId,
        quotedText: ctx.quotedText,
      });

      if (!mention && !atMention && !isContinuation) return { responded: false, reason: 'no-trigger' };
      if (o.cooldownMs > 0 && !isContinuation && isInCooldown(scopeKey, now, o.cooldownMs)) return { responded: false, reason: 'cooldown' };
      if (o.maxTurns > 0 && isContinuation && thread && thread.turnCount >= thread.maxTurns) return { responded: false, reason: 'thread-limit' };

      // Resolução / Download de imagens para visão da persona
      const resolvedImages = [];
      if (hasImageMedia && rawMsg) {
        try {
          const downloaded = await downloadResolvedMedia({
            rawMsg,
            sock: ctx.sock,
            logger,
            maxBytes: 8 * 1024 * 1024,
          });
          if (downloaded?.ok && downloaded.buffer && downloaded.buffer.length > 0) {
            const mime = downloaded.mimeType || 'image/jpeg';
            const dataUrl = `data:${mime};base64,${downloaded.buffer.toString('base64')}`;
            resolvedImages.push(dataUrl);
          }
        } catch (mediaErr) {
          logger?.debug?.('[personaService] download de imagem da persona falhou: %s', String(mediaErr?.message || mediaErr));
        }
      }

      let threadContext = [];
      if (thread?.context?.length) threadContext = thread.context;

      const participantJids = [authorJid, ...(ctx.mentionedJids || []), quotedRaw].filter(Boolean);
      const authorLabel = profileService?.displayName
        ? profileService.displayName(authorJid, scopeKey)
        : authorJid.split('@')[0] || 'membro';

      const rawPromptText = String(ctx.text || '').trim() || (resolvedImages.length > 0 ? (isContinuation ? 'O que você acha dessa imagem?' : 'Descreva e comente o que você vê nesta imagem.') : '');
      const mentionMap = new Map();
      for (const jid of ctx.mentionedJids || []) {
        const normalized = normalizeJid(jid);
        if (!normalized || mentionMap.has(normalized)) continue;
        const localPart = normalized.split('@')[0];
        const displayName = profileService?.displayName
          ? profileService.displayName(normalized, scopeKey)
          : localPart;
        mentionMap.set(normalized, {
          jid: normalized,
          localPart,
          displayName: String(displayName || localPart),
          nickname: '',
        });
      }
      const promptText = resolveMentionsInText(rawPromptText, mentionMap);

      inFlightScopes.add(scopeKey);
      let genResult = await generateResponse({
        text: promptText,
        images: resolvedImages,
        scopeKey,
        funConfig: ctx.funConfig,
        threadContext,
        responseContextPack: ctx.responseContextPack,
        participantJids,
        authorLabel,
        quotedText: ctx.quotedText,
        agentContext: {
          authorJid,
          mentionedJids: ctx.mentionedJids || [],
          quotedParticipant: quotedRaw,
          getContactDisplayName: profileService?.displayName
            ? (jid) => profileService.displayName(jid, scopeKey)
            : null,
          replyImageUrl: async (imageUrl, caption, mimeType) => {
            const url = String(imageUrl || '').trim();
            if (!url || typeof ctx.sock?.sendMessage !== 'function') throw new Error('image-sender-unavailable');
            const quoted = ctx.funConfig?.replyQuoted !== false && ctx.quoteSource?.key
              ? ctx.quoteSource
              : undefined;
            return ctx.sock.sendMessage(
              scopeKey,
              { image: { url }, caption: String(caption || ''), mimetype: String(mimeType || '') || undefined },
              quoted ? { quoted } : undefined
            );
          },
          replySticker: async (stickerBuffer) => {
            if (!Buffer.isBuffer(stickerBuffer) || typeof ctx.sock?.sendMessage !== 'function') {
              throw new Error('sticker-sender-unavailable');
            }
            const quoted = ctx.funConfig?.replyQuoted !== false && ctx.quoteSource?.key
              ? ctx.quoteSource
              : undefined;
            return ctx.sock.sendMessage(
              scopeKey,
              { sticker: stickerBuffer },
              quoted ? { quoted } : undefined
            );
          },
          now,
        },
      });

      let responseText = '';
      let actions = [];
      let usedFallback = false;

      if (typeof genResult === 'string') {
        responseText = genResult;
        actions = genResult ? [{ type: 'text', text: genResult }] : [];
      } else if (genResult && typeof genResult === 'object') {
        responseText = String(genResult.text || '');
        actions = Array.isArray(genResult.actions) ? genResult.actions : [{ type: 'text', text: responseText }];
      }

      if (!responseText && !actions.length) {
        responseText = fallbackResponse(now);
        actions = [{ type: 'text', text: responseText }];
        usedFallback = true;
      }

      const quoted = ctx.funConfig?.replyQuoted !== false && ctx.quoteSource?.key
        ? ctx.quoteSource
        : undefined;

      // ── DESPACHO MULTI-AÇÃO COM HUMAN PACING ──
      const responseMessageIds = [];
      const hasSock = ctx.sock?.sendMessage && typeof ctx.sock.sendMessage === 'function';

      for (let i = 0; i < actions.length; i += 1) {
        const action = actions[i];
        if (!action) continue;

        try {
          if (action.type === 'text' && hasSock) {
            const sent = await ctx.sock.sendMessage(scopeKey, { text: action.text }, quoted ? { quoted } : undefined);
            if (sent?.key?.id) {
              responseMessageIds.push(String(sent.key.id));
            }
          } else if (action.type === 'sticker' && hasSock) {
            const stickerPath = resolveStickerPath(action.slug);
            if (stickerPath) {
              const rawSticker = readFileSync(stickerPath);
              const stickerBuffer = await imageBufferToSticker(rawSticker);
              const sent = await ctx.sock.sendMessage(scopeKey, { sticker: stickerBuffer }, quoted ? { quoted } : undefined);
              if (sent?.key?.id) {
                responseMessageIds.push(String(sent.key.id));
              }
            }
          } else if (action.type === 'react' && hasSock && ctx.quoteSource?.key) {
            await ctx.sock.sendMessage(scopeKey, {
              react: { text: action.emoji, key: ctx.quoteSource.key },
            });
          }
        } catch (dispatchErr) {
          logger?.debug?.('[personaService] erro ao despachar ação %s: %s', action.type, String(dispatchErr?.message || dispatchErr));
        }

        // Delay natural entre balões/ações (se não for última e não for teste)
        if (i < actions.length - 1 && process.env.NODE_ENV !== 'test') {
          await sleep(Math.floor(Math.random() * 250 + 350));
        }
      }

      setCooldown(scopeKey, now);

      if (isContinuation && thread) {
        const cont = personaRepository.continueThread({
          threadId: thread.id,
          context: [
            ...threadContext,
            memberTurn(authorLabel, ctx.text),
            { role: 'bot', text: responseText.slice(0, 200) },
          ],
          now,
        });
        if (!cont?.ok) logger?.debug?.('[personaService] continueThread falhou: %s', cont?.reason || '?');
      } else {
        thread = personaRepository.openThread({
          scopeKey,
          maxTurns: o.maxTurns,
          context: [
            memberTurn(authorLabel, ctx.text),
            { role: 'bot', text: responseText.slice(0, 200) },
          ],
          now,
        });
      }

      const uniqueResponseMessageIds = [...new Set(responseMessageIds.filter(Boolean))];
      if (!uniqueResponseMessageIds.length) uniqueResponseMessageIds.push(randomUUID());

      if (thread?.id) {
        const anchored = personaRepository.setAnchor({
          threadId: thread.id,
          anchorMessageIds: uniqueResponseMessageIds,
          anchorText: responseText,
          now,
        });
        if (!anchored?.ok) logger?.debug?.('[personaService] setAnchor falhou: %s', anchored?.reason || '?');
      }

      const threadKey = String(ctx.responseContextPack?.threadContext?.threadKey || '');
      if (threadKey) {
        threadContextService?.anchorResponse?.({
          scopeKey,
          threadKey,
          anchorMessageId: uniqueResponseMessageIds[0],
          ...(uniqueResponseMessageIds.length > 1
            ? { anchorMessageIds: uniqueResponseMessageIds }
            : {}),
          now,
        });
      }

      return { responded: true, response: responseText, usedFallback, threadId: thread?.id || 0 };
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
    detectTrigger: detectTriggerInternal,
    isInCooldown,
    buildStyleBlock,
    buildSystemPrompt,
    generateResponse,
    composeSystemAnnouncement,
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
