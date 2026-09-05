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
import { sanitizeFlavor, looksLikeScoreboardEcho } from '../llm/flavorService.js';
import { openaiChatComplete } from '../llm/openaiClient.js';
import { resolveZenEndpoint } from '../llm/zenEndpoint.js';
import { resolveZenTaskParams } from '../llm/zenTaskParams.js';
import { PERSONA_CONTEXT_TURNS, PERSONA_DERIVE_INTERVAL_MS, PERSONA_TOKEN_HALF_LIFE_MS, PERSONA_TOP_TOKENS } from '../constants.js';
import { buildPersonaToolManifest, parseFollowupEnvelope, parsePersonaEnvelope, looksLikeRawJson } from './personaToolProtocol.js';
import { isUsablePromptFact } from '../utils/promptFactSanitizer.js';
import { buildFactTemporalContext, formatDatedFact } from '../utils/factTemporalContext.js';
import { resolveStickerPath } from './personaStickerCatalog.js';
import { imageBufferToSticker } from '../utils/stickerConvert.js';
import { resolveMediaFromRawMessage, downloadResolvedMedia } from '../utils/mediaDownload.js';
import {
  cleanPromptText,
  buildPersonaIdentityBlock,
  buildTemporalBlock,
  buildToneBlock,
  buildPersonaSystemPrompt,
  buildPersonaUserPrompt,
  buildPersonaFollowupPrompt,
  buildSocialHintBlock,
  memorySignalText,
} from './personaPromptBuilder.js';
import { buildMentionedUsersContextBlock, resolveMentionsInText } from '../utils/mentionResolver.js';
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

function stripToolEcho(text, toolText) {
  const norm = (str) =>
    String(str || '')
      .replace(/[“”„‟]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  const source = String(text || '').trim();
  const sourceNorm = norm(source);
  const toolNorm = norm(toolText);
  if (!sourceNorm || !toolNorm) return source;
  if (sourceNorm === toolNorm) return '';
  if (sourceNorm.startsWith(toolNorm)) {
    const rawRest = source.slice(toolText ? toolText.length : 0).trim();
    return rawRest.replace(/^[:\-–—\s]+/, '').trim();
  }
  return source;
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
  personaRecentMessageRepository = null,
  personaAutonomyPolicy = null,
  clock = () => Date.now(),
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

  async function runPersonaToolLoop({ initialCall, system, prompt, endpoint, zen, timeoutMs, funConfig, agentContext, scopeKey, text, maxChars }) {
    const maxCalls = Math.max(1, Math.min(6, Number(funConfig?.personaAgentMaxToolCalls) || 4));
    const deadlineAt = clock() + Math.max(5_000, Number(funConfig?.personaAgentDeadlineMs) || timeoutMs);
    const executed = new Set();
    const trace = [];
    let lastDisplayText = '';
    let call = initialCall;

    for (let index = 0; index < maxCalls && clock() < deadlineAt; index += 1) {
      const callKey = `${call.name}:${JSON.stringify(call.arguments || {})}`;
      if (executed.has(callKey)) break;
      executed.add(callKey);

      const toolResult = await personaToolExecutor.execute(call, {
        ...agentContext,
        scopeKey,
        text,
        funConfig,
        now: Number(agentContext?.now) || Date.now(),
      });
      const displayText = cleanPromptText(toolResult?.text, Math.max(600, maxChars * 6));
      if (toolResult?.ok && displayText) lastDisplayText = displayText;
      const summary = cleanPromptText(
        toolResult?.summary || displayText || `Ferramenta ${call.name} terminou sem texto.`,
        Math.max(600, maxChars * 6)
      );
      trace.push({ name: call.name, ok: Boolean(toolResult?.ok), summary });
      const traceText = trace.map((item, itemIndex) => `${itemIndex + 1}. ${item.name} (${item.ok ? 'ok' : 'falhou'}): ${item.summary}`).join('\n');
      const remainingMs = deadlineAt - clock();

      // A tool já concluiu dentro do seu próprio timeout. Não inicia uma geração
      // que não cabe mais no orçamento do loop nem reexecuta a tool em retry.
      if (remainingMs <= 0) break;

      const raw = await generateZen({
        baseUrl: endpoint.baseUrl,
        model: endpoint.model,
        prompt: `${prompt}\n\nResultados reais das ferramentas:\n${traceText}\n\nEscolha a próxima tool, se precisar, ou responda naturalmente com reply/actions. Não invente dados ausentes.`,
        system: `${system}\n\n${buildPersonaToolManifest()}`,
        timeoutMs: Math.min(timeoutMs, remainingMs),
        maxTokens: zen.maxTokens,
        temperature: zen.temperature,
        apiKey: endpoint.apiKey,
        sendSamplingParams: funConfig?.zenSendSamplingParams !== false,
        jsonMode: true,
        jsonOnly: true,
      });
      const decision = parsePersonaEnvelope(raw, { maxChars });
      if (!decision.ok) break;
      if (decision.envelope.type === 'tool_call') {
        const fallback = sanitizeFlavor(lastDisplayText, Math.max(maxChars, 1_600));
        return fallback ? { text: fallback, actions: [{ type: 'text', text: fallback }] } : '';
      }
      if (decision.envelope.type === 'actions') {
        const finalActions = [];
        for (const action of decision.envelope.actions) {
          if (action.type !== 'text') {
            finalActions.push(action);
            continue;
          }
          const stripped = stripToolEcho(action.text, lastDisplayText);
          const sanitized = sanitizeFlavor(stripped, maxChars);
          if (sanitized) finalActions.push({ ...action, text: sanitized });
        }
        const finalText = finalActions.filter((action) => action.type === 'text')
          .map((action) => action.text).filter(Boolean).join('\n\n');
        const combined = [lastDisplayText, finalText].filter(Boolean).join('\n\n');
        return {
          text: combined || '👍',
          actions: lastDisplayText
            ? [{ type: 'text', text: lastDisplayText }, ...finalActions]
            : finalActions,
        };
      }
      if (decision.envelope.type === 'reply') {
        const stripped = stripToolEcho(decision.envelope.text, lastDisplayText);
        const reply = sanitizeFlavor(stripped, maxChars);
        if (reply && !looksLikeScoreboardEcho(reply)) {
          const combined = [lastDisplayText, reply].filter(Boolean).join('\n\n');
          return { text: combined, actions: [{ type: 'text', text: combined }] };
        }
      }
      break;
    }

    const lastResult = lastDisplayText || trace.at(-1)?.summary || '';
    const fallback = sanitizeFlavor(lastResult, Math.max(maxChars, 1_600));
    return fallback ? { text: fallback, actions: [{ type: 'text', text: fallback }] } : '';
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
    mentionedUsersMap = null,
    agentContext = null,
  }) {
    const o = opts(funConfig);
    const groupIdentity = responseContextPack?.groupIdentity || {};
    const identityStyle = (groupIdentity.voiceStyle || []).filter(Boolean).join(', ') || '';
    const personaIdentityBlock = buildPersonaIdentityBlock(groupIdentity);
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
    const mentionedUsersBlock = buildMentionedUsersContextBlock(mentionedUsersMap, {
      getProfile: profileService?.getProfile
        ? (jid) => profileService.getProfile(jid, scopeKey)
        : null,
      scopeKey,
      loreFacts: responseContextPack?.loreFacts || [],
      timeZone: o.timezone,
    });
    const mentionContextIsAlreadyPresent = extraContextBlock.includes('<mentioned_users>');

    const styleBlock = [
      buildStyleBlock(scopeKey),
      identityStyle ? `Voz observada do grupo: ${identityStyle}.` : '',
      personaIdentityBlock,
      toneBlock,
      loreBlock,
      identityBlock,
      socialHintBlock,
      inferredBlock,
      extraContextBlock,
      mentionContextIsAlreadyPresent ? '' : mentionedUsersBlock,
    ].filter(Boolean).join('\n');

    const contextTurns = responseContextPack?.threadContext?.topicSummary
      ? [...(threadContext || []), { role: 'contexto', text: responseContextPack.threadContext.topicSummary }]
      : threadContext;
    const immediateContext = Array.isArray(responseContextPack?.immediateContext)
      ? responseContextPack.immediateContext
      : [];

    const currentNow = Number(agentContext?.now) || Date.now();
    const facts = (responseContextPack?.confirmedFacts || [])
      .map((memory) => {
        const text = cleanPromptText(memory.factText, Infinity);
        if (!text || !isUsablePromptFact(text)) return '';
        return formatDatedFact(memory, text, o.timezone);
      })
      .filter(Boolean);

    const system = [
      buildPersonaSystemPrompt({
        styleBlock,
        threadContext: contextTurns,
        immediateContext,
        maxChars: o.maxChars,
        contextTurns: o.contextTurns,
      }),
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
    const toolContextText = [
      text,
      quotedText,
      ...(Array.isArray(contextTurns) ? contextTurns.map((turn) => turn?.text) : []),
      ...immediateContext.map((message) => message?.text),
    ].map((value) => cleanPromptText(value, 500)).filter(Boolean).join('\n');

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

          // Caso 3: loop agentivo limitado. Cada resultado é real e retorna ao
          // modelo, que pode consultar outra tool ou finalizar com actions/reply.
          if (decision.ok && decision.envelope.type === 'tool_call') {
            const result = await runPersonaToolLoop({
              initialCall: decision.envelope,
              system,
              prompt,
              endpoint: ep,
              zen,
              timeoutMs: Math.min(o.timeoutMs, zen.timeoutMs || 15_000),
              funConfig,
              agentContext: { ...agentContext, toolContextText },
              scopeKey,
              text,
              maxChars: o.maxChars,
            });
            if (result) return result;
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

  async function tryIdleFollowUp(ctx = {}) {
    const scopeKey = String(ctx.scopeKey || '');
    const candidates = Array.isArray(ctx.candidates) ? ctx.candidates.filter((item) => item?.messageId && item?.text) : [];
    const o = opts(ctx.funConfig);
    if (!o.enabled) return { responded: false, reason: 'disabled-global' };
    if (!scopeKey.endsWith('@g.us')) return { responded: false, reason: 'invalid' };
    if (!candidates.length) return { responded: false, reason: 'no-candidates' };
    if ((ctx.groupSettings || groupRepository.getGroupSettings(scopeKey))?.personaEnabled === false) {
      return { responded: false, reason: 'disabled-group' };
    }
    if (inFlightScopes.has(scopeKey)) return { responded: false, reason: 'in-flight' };
    if (process.env.FUN_DISABLE_LIVE_LLM === '1' || ctx.funConfig?.zenEnabled === false) {
      return { responded: false, reason: 'llm-disabled' };
    }

    const now = Number(ctx.now) || Date.now();
    const candidateIds = candidates.map((candidate) => String(candidate.messageId));
    const system = [
      buildPersonaSystemPrompt({
        styleBlock: buildStyleBlock(scopeKey),
        threadContext: ctx.responseContextPack?.threadContext?.context || [],
        immediateContext: ctx.responseContextPack?.immediateContext || [],
        maxChars: o.maxChars,
        contextTurns: o.contextTurns,
      }),
      buildTemporalBlock(now, o.timezone),
      'Neste turno, não use ferramentas, stickers ou reações. Só entre se sua fala for naturalmente bem-vinda.',
    ].filter(Boolean).join('\n\n');
    const prompt = buildPersonaFollowupPrompt({ candidates, maxChars: o.maxChars });
    const zen = resolveZenTaskParams('persona', ctx.funConfig || {});
    const endpoint = resolveZenEndpoint(ctx.funConfig || {});

    inFlightScopes.add(scopeKey);
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
        sendSamplingParams: ctx.funConfig?.zenSendSamplingParams !== false,
        jsonMode: true,
        jsonOnly: true,
      });
      const parsed = parseFollowupEnvelope(raw, { maxChars: o.maxChars, allowedReplyMessageIds: candidateIds });
      if (!parsed.ok || parsed.envelope.type === 'ignore') return { responded: false, reason: parsed.reason || 'ignored' };
      const selected = candidates.find((candidate) => String(candidate.messageId) === parsed.envelope.replyToMessageId);
      if (!selected) return { responded: false, reason: 'invalid-reply-target' };
      const text = parsed.envelope.text || parsed.envelope.actions
        ?.filter((action) => action.type === 'text').map((action) => action.text).join('\n\n');
      const response = sanitizeFlavor(text, o.maxChars);
      if (!response || looksLikeScoreboardEcho(response)) return { responded: false, reason: 'invalid-generation' };
      if (typeof ctx.sock?.sendMessage !== 'function') return { responded: false, reason: 'sender-unavailable' };

      const quoteSource = {
        key: {
          remoteJid: scopeKey,
          id: String(selected.messageId),
          participant: String(selected.authorJid || ''),
          fromMe: false,
        },
        message: { conversation: String(selected.text || '') },
      };
      const sent = await ctx.sock.sendMessage(scopeKey, { text: response }, { quoted: quoteSource });
      const responseMessageId = String(sent?.key?.id || '');
      if (responseMessageId) {
        try {
          personaRecentMessageRepository?.recordMessage?.({
            scopeKey,
            messageId: responseMessageId,
            authorJid: String(ctx.sock?.user?.id || ''),
            authorLabel: 'eu',
            source: 'bot',
            messageType: 'text',
            text: response,
            now,
          });
        } catch { /* registro observacional */ }
      }
      // O follow-up é uma fala normal da persona. Ancore-a na thread ativa para
      // que um reply do membro a esta mensagem volte pelo fluxo de continuação.
      const responseMessageIds = responseMessageId ? [responseMessageId] : [];
      let thread = personaRepository.getActiveThread(scopeKey, { now, ttlMs: o.threadTtlMs });
      const followupContext = [
        ...(thread?.context || []),
        memberTurn(selected.authorLabel || 'membro', selected.text),
        { role: 'bot', text: response.slice(0, Math.max(400, o.maxChars)) },
      ].slice(-Math.max(4, o.contextTurns));
      if (thread?.id) {
        const continued = personaRepository.continueThread({ threadId: thread.id, context: followupContext, now });
        if (!continued?.ok) thread = null;
      }
      if (!thread?.id) {
        thread = personaRepository.openThread({
          scopeKey,
          maxTurns: o.maxTurns,
          context: followupContext,
          now,
        });
      }
      if (thread?.id && responseMessageIds.length) {
        personaRepository.setAnchor({
          threadId: thread.id,
          anchorMessageIds: responseMessageIds,
          anchorText: response,
          now,
        });
      }
      return {
        responded: true,
        response,
        responseMessageIds,
        sourceMessageId: String(selected.messageId),
        threadId: thread?.id || 0,
        trigger: 'idle-follow-up',
      };
    } catch (error) {
      logger?.debug?.('[personaService] follow-up autônomo falhou: %s', String(error?.message || error));
      return { responded: false, reason: 'generation-or-send-error' };
    } finally {
      inFlightScopes.delete(scopeKey);
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

      // A continuação é resolvida pela âncora citada, não pela thread mais
      // recente do grupo. Conversas paralelas não podem competir por recência.
      const anchoredThread = personaRepository.getActiveThreadByAnchor
        ? personaRepository.getActiveThreadByAnchor(scopeKey, {
            quotedMessageId: ctx.quotedMessageId,
            quotedText: ctx.quotedText,
            now,
            ttlMs: o.threadTtlMs,
          })
        : personaRepository.getActiveThread(scopeKey, { now, ttlMs: o.threadTtlMs });
      const isContinuation = !mention && !atMention && isThreadContinuation({
        quotedIsBot,
        thread: anchoredThread,
        quotedMessageId: ctx.quotedMessageId,
        quotedText: ctx.quotedText,
      });
      let thread = isContinuation ? anchoredThread : null;

      const autonomy = !mention && !atMention && !isContinuation
        ? personaAutonomyPolicy?.evaluate?.({
            scopeKey,
            text: ctx.text,
            messageType: ctx.messageType,
            immediateContext: ctx.responseContextPack?.immediateContext || [],
            socialSignals: ctx.responseContextPack?.socialSignals || [],
            funConfig: ctx.funConfig,
            currentNow: now,
          })
        : null;
      const isAutonomous = Boolean(autonomy?.eligible);

      if (!mention && !atMention && !isContinuation && !isAutonomous) {
        personaAutonomyPolicy?.observeHumanMessage?.(scopeKey, { text: ctx.text, currentNow: now });
        return { responded: false, reason: autonomy?.reason || 'no-trigger' };
      }
      if (o.cooldownMs > 0 && !isContinuation && !isAutonomous && isInCooldown(scopeKey, now, o.cooldownMs)) return { responded: false, reason: 'cooldown' };
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

      const canonicalMentionedJidsFromContext = (ctx.mentionedJids || []).map((jid) => {
        const normalized = normalizeJid(jid);
        return resolveJid(normalized, ctx.identityMap) || normalized;
      }).filter(Boolean);
      const participantJids = [authorJid, ...canonicalMentionedJidsFromContext, quotedRaw].filter(Boolean);
      const authorLabel = profileService?.displayName
        ? profileService.displayName(authorJid, scopeKey)
        : authorJid.split('@')[0] || 'membro';

      const rawPromptText = String(ctx.text || '').trim() || (resolvedImages.length > 0 ? (isContinuation ? 'O que você acha dessa imagem?' : 'Descreva e comente o que você vê nesta imagem.') : '');
      const mentionMap = new Map();
      const canonicalMentionedJids = [];
      const looksLikeRawNumber = (value) => /^\d{8,20}$/.test(String(value || '').trim());
      const resolveMentionDisplayName = (candidateJids) => {
        if (!profileService?.displayName) return '';
        const candidates = new Set(candidateJids.map((jid) => String(jid || '').trim()).filter(Boolean));
        // V7 mantém o LID como identidade do domínio. O PN é consultado
        // apenas como alias transitório para nomes ainda não migrados.
        for (const candidate of [...candidates]) {
          const pn = ctx.identityMap?.getPn?.(candidate);
          if (pn) candidates.add(pn);
        }
        for (const candidate of candidates) {
          const name = String(profileService.displayName(candidate, scopeKey) || '').trim();
          if (name && !looksLikeRawNumber(name)) return name;
        }
        return '';
      };
      const resolveMention = (rawJid) => {
        const rawNormalized = normalizeJid(rawJid);
        if (!rawNormalized) return '';
        // Resolve para o LID primário. O PN, quando houver, é usado somente
        // como alias de leitura em resolveMentionDisplayName.
        const canonical = resolveJid(rawNormalized, ctx.identityMap) || rawNormalized;
        if (mentionMap.has(canonical)) return canonical;
        // rawLocal é o número exatamente como aparece renderizado no texto
        // (para lid, o número do lid); canonicalLocal, o do JID resolvido.
        const rawLocal = rawNormalized.split('@')[0];
        const canonicalLocal = canonical.split('@')[0];
        // Alguns snapshots expõem o nome no LID, mas a menção vem como um
        // número opaco em @s.whatsapp.net. Consulta todos os aliases estáveis.
        const displayName = resolveMentionDisplayName([
          canonical,
          rawNormalized,
          `${rawLocal}@lid`,
          `${rawLocal}@s.whatsapp.net`,
        ]);
        mentionMap.set(canonical, {
          jid: canonical,
          localPart: rawLocal || canonicalLocal,
          localParts: [...new Set([rawLocal, canonicalLocal].filter(Boolean))],
          displayName: displayName || rawLocal || 'alguém',
          hasRealName: Boolean(displayName),
          nickname: '',
        });
        if (!canonicalMentionedJids.includes(canonical)) canonicalMentionedJids.push(canonical);
        return canonical;
      };
      // O runtime entrega JIDs canônicos para a economia/memória, mas conserva
      // os JIDs originais aqui para que o número que o WhatsApp renderizou no
      // texto (@LID) também seja substituído pelo nome real.
      const mentionRenderAliases = Array.isArray(ctx.rawMentionedJids) && ctx.rawMentionedJids.length > 0
        ? ctx.rawMentionedJids
        : ctx.mentionedJids || [];
      for (const jid of mentionRenderAliases) resolveMention(jid);
      for (const jid of ctx.mentionedJids || []) resolveMention(jid);

      // Fallback: menções que chegam só como @numero no texto (contextInfo sem
      // mentionedJid do Baileys). Tenta achar cada número como lid ou PN e só
      // injeta no mapa quando um nome real é resolvido.
      for (const match of String(rawPromptText).matchAll(/(^|[\s(:>])@(\d{8,20})\b/g)) {
        const digits = match[2];
        const alreadyKnown = [...mentionMap.values()].some((info) => info.localParts?.includes?.(digits) || info.localPart === digits);
        if (alreadyKnown) continue;
        for (const candidate of [`${digits}@lid`, `${digits}@s.whatsapp.net`]) {
          const canonical = resolveJid(normalizeJid(candidate), ctx.identityMap);
          if (!canonical) continue;
          const name = resolveMentionDisplayName([
            canonical,
            candidate,
            `${digits}@lid`,
            `${digits}@s.whatsapp.net`,
          ]);
          if (!name) continue;
          if (!mentionMap.has(canonical)) {
            mentionMap.set(canonical, {
              jid: canonical,
              localPart: digits,
              localParts: [...new Set([digits, canonical.split('@')[0]].filter(Boolean))],
              displayName: name,
              hasRealName: true,
              nickname: '',
            });
            if (!canonicalMentionedJids.includes(canonical)) canonicalMentionedJids.push(canonical);
          }
          break;
        }
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
        mentionedUsersMap: mentionMap,
        agentContext: {
          authorJid,
          mentionedJids: canonicalMentionedJids.length
            ? canonicalMentionedJids
            : canonicalMentionedJidsFromContext,
          quotedParticipant: quotedRaw,
          getContactDisplayName: profileService?.displayName
            ? (jid) => profileService.displayName(jid, scopeKey)
            : null,
          replyImageUrl: typeof ctx.replyImageUrl === 'function'
            ? ctx.replyImageUrl
            : async (imageUrl, caption, mimeType) => {
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
          replySticker: typeof ctx.replySticker === 'function'
            ? ctx.replySticker
            : async (stickerBuffer) => {
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
          replyReact: async (emoji) => {
            const e = String(emoji || '').trim();
            if (!e || typeof ctx.sock?.sendMessage !== 'function') return;
            const targetKey = ctx.quoteSource?.key || ctx.messageKey;
            if (!targetKey) return;
            return ctx.sock.sendMessage(scopeKey, {
              react: { text: e, key: targetKey },
            });
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
              try {
                personaRecentMessageRepository?.recordMessage?.({
                  scopeKey,
                  messageId: String(sent.key.id),
                  authorJid: [...botJids][0] || '',
                  authorLabel: 'eu',
                  source: 'bot',
                  messageType: 'text',
                  text: action.text,
                  now,
                });
              } catch {
                // histórico recente nunca desfaz uma resposta já enviada
              }
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
      if (isAutonomous) personaAutonomyPolicy?.recordSent?.(scopeKey, now);

      if (isContinuation && thread) {
        const cont = personaRepository.continueThread({
          threadId: thread.id,
          context: [
            ...threadContext,
            memberTurn(authorLabel, ctx.text),
            { role: 'bot', text: responseText.slice(0, Math.max(400, o.maxChars)) },
          ].slice(-Math.max(4, o.contextTurns)),
          now,
        });
        if (!cont?.ok) logger?.debug?.('[personaService] continueThread falhou: %s', cont?.reason || '?');
      } else {
        thread = personaRepository.openThread({
          scopeKey,
          maxTurns: o.maxTurns,
          context: [
            memberTurn(authorLabel, ctx.text),
            { role: 'bot', text: responseText.slice(0, Math.max(400, o.maxChars)) },
          ].slice(-Math.max(4, o.contextTurns)),
          now,
        });
      }

      const uniqueResponseMessageIds = [...new Set(responseMessageIds.filter(Boolean))];

      if (thread?.id && (uniqueResponseMessageIds.length || responseText)) {
        const anchored = personaRepository.setAnchor({
          threadId: thread.id,
          anchorMessageIds: uniqueResponseMessageIds,
          anchorText: responseText,
          now,
        });
        if (!anchored?.ok) logger?.debug?.('[personaService] setAnchor falhou: %s', anchored?.reason || '?');
      }

      const threadKey = String(ctx.responseContextPack?.threadContext?.threadKey || '');
      if (threadKey && uniqueResponseMessageIds.length) {
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

      return {
        responded: true,
        response: responseText,
        responseMessageIds: uniqueResponseMessageIds,
        usedFallback,
        threadId: thread?.id || 0,
        trigger: isAutonomous ? 'autonomous' : isContinuation ? 'continuation' : atMention ? 'at-mention' : 'mention',
      };
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
    tryIdleFollowUp,
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
