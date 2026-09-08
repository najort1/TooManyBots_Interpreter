import { sanitizeFlavor, looksLikeScoreboardEcho } from '../llm/flavorService.js';
import { openaiChatComplete } from '../llm/openaiClient.js';
import { resolveZenEndpoint } from '../llm/zenEndpoint.js';
import { resolveZenTaskParams } from '../llm/zenTaskParams.js';
import { STICKER_SLUGS } from './personaStickerCatalog.js';
import { EMOJI_RE, looksLikeRawJson } from './personaToolProtocol.js';
import { isUsablePromptFact } from '../utils/promptFactSanitizer.js';
import { cleanPromptText, memorySignalText } from './personaPromptBuilder.js';

const ACTIONS = new Set(['pass', 'react', 'sticker', 'comment']);
const ALLOWED_ACTIONS = new Set(['react', 'sticker', 'comment']);
const SENSITIVE_TEXT = /\b(?:cpf|rg|senha|password|token|api[_-]?key|pix|cart[aã]o|endereço|endereco|telefone|celular|suic[ií]dio|abuso)\b/iu;
const CANDIDATE_SIGNAL = /\?|\b(?:kkkk+|haha+|rsrs+|meme|piada|mds|meu deus|socorro|parab[eé]ns|feliz anivers[aá]rio|ganhei|ganhamos|vit[oó]ria|bizarro|olha isso)\b/iu;
const COLLECTIVE_QUESTION = /\b(?:quem|qual|algu[eé]m|voc[eê]s|gente|galera)\b[^\n]{0,140}\?/iu;

function jsonObject(raw) {
  const text = String(raw || '').trim();
  if (!text || (!text.startsWith('{') && !text.startsWith('```'))) return null;
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  try {
    const parsed = JSON.parse((fenced?.[1] || text).trim());
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function allowedActions(funConfig = {}) {
  const configured = Array.isArray(funConfig.personaAutonomyAllowedActions)
    ? funConfig.personaAutonomyAllowedActions
    : [...ALLOWED_ACTIONS];
  return new Set(configured.map((value) => String(value || '').trim().toLowerCase()).filter((value) => ALLOWED_ACTIONS.has(value)));
}

function cleanShortText(value, maxChars) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > maxChars || looksLikeRawJson(raw)) return '';
  const cleaned = sanitizeFlavor(cleanPromptText(raw, maxChars), maxChars);
  if (!cleaned || cleaned.length > maxChars || looksLikeRawJson(cleaned) || looksLikeScoreboardEcho(cleaned)) return '';
  return cleaned;
}

function isEmptyOptional(value) {
  return value === null || value === undefined || value === '';
}

/** Faz parse estrito da decisão, sem deixar o modelo impor a política de envio. */
export function parsePersonaOpportunityEnvelope(raw, {
  minScore = 75,
  allowed = ALLOWED_ACTIONS,
  commentMaxChars = 140,
  contextCount = 0,
  batchLength = 1,
} = {}) {
  const value = jsonObject(raw);
  if (!value) return { ok: false, reason: 'invalid-json' };

  const validKeys = new Set([
    'action', 'score', 'reason', 'emoji', 'stickerSlug', 'commentText',
    'target_message_index', 'targetMessageIndex',
  ]);
  const keys = Object.keys(value);
  if (keys.some((key) => !validKeys.has(key))) {
    return { ok: false, reason: 'invalid-shape' };
  }
  if (!('action' in value) || !('score' in value) || !('reason' in value)) {
    return { ok: false, reason: 'invalid-shape' };
  }

  const action = String(value.action || '').trim().toLowerCase();
  if (!ACTIONS.has(action) || !Number.isInteger(value.score) || value.score < 0 || value.score > 100) {
    return { ok: false, reason: 'invalid-decision' };
  }

  const reason = String(value.reason || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 160);
  if (!reason) return { ok: false, reason: 'missing-reason' };

  const rawIndex = value.target_message_index ?? value.targetMessageIndex;
  let targetIndex = null;
  if (Number.isInteger(rawIndex)) {
    if (rawIndex >= contextCount && rawIndex < batchLength) {
      targetIndex = rawIndex;
    }
  }

  if (action === 'pass') {
    if (!isEmptyOptional(value.emoji) || !isEmptyOptional(value.stickerSlug) || !isEmptyOptional(value.commentText)) {
      return { ok: false, reason: 'invalid-pass-payload' };
    }
    return { ok: true, decision: { action, score: value.score, reason, targetMessageIndex: null, outputAction: null } };
  }

  if (!allowed.has(action)) return { ok: false, reason: 'action-disabled' };
  if (value.score < minScore) return { ok: false, reason: 'low-score', score: value.score };

  if (action === 'react') {
    const emoji = String(value.emoji || '').trim();
    if (!EMOJI_RE.test(emoji) || !isEmptyOptional(value.stickerSlug) || !isEmptyOptional(value.commentText)) {
      return { ok: false, reason: 'invalid-react' };
    }
    return { ok: true, decision: { action, score: value.score, reason, targetMessageIndex: targetIndex, outputAction: { type: 'react', emoji } } };
  }

  if (action === 'sticker') {
    const slug = String(value.stickerSlug || '').trim();
    if (!STICKER_SLUGS.includes(slug) || !isEmptyOptional(value.emoji) || !isEmptyOptional(value.commentText)) {
      return { ok: false, reason: 'invalid-sticker' };
    }
    return { ok: true, decision: { action, score: value.score, reason, targetMessageIndex: targetIndex, outputAction: { type: 'sticker', slug } } };
  }

  const text = cleanShortText(value.commentText, commentMaxChars);
  if (!text || !isEmptyOptional(value.emoji) || !isEmptyOptional(value.stickerSlug)) {
    return { ok: false, reason: 'invalid-comment' };
  }
  return { ok: true, decision: { action, score: value.score, reason, targetMessageIndex: targetIndex, outputAction: { type: 'text', text } } };
}

function isCandidate({ text, messageType, immediateContext, minMessages }) {
  const message = String(text || '').trim();
  const type = String(messageType || '').toLowerCase();
  if (type === 'image' || type === 'album' || type === 'sticker') return true;
  if (!message) return false;
  if (CANDIDATE_SIGNAL.test(message) || COLLECTIVE_QUESTION.test(message)) return true;
  return Array.isArray(immediateContext) && immediateContext.length >= minMessages && message.length >= 24;
}

function sanitizeContextMessage(message, maxChars) {
  const text = cleanPromptText(message?.text, maxChars);
  if (!text || SENSITIVE_TEXT.test(text)) return '';
  const author = cleanPromptText(message?.authorLabel || 'membro', 60) || 'membro';
  return `${author}: ${text}`;
}

function factText(fact, maxChars) {
  if (!fact || (fact.sensitivityLevel != null && String(fact.sensitivityLevel) !== 'safe')) return '';
  const text = cleanPromptText(fact.factText || fact.summary, maxChars);
  return text && isUsablePromptFact(text) && !SENSITIVE_TEXT.test(text) ? text : '';
}

function buildPromptContext({ text, authorLabel, responseContextPack, funConfig }) {
  const maxContextMessages = Math.max(1, Math.min(12, Number(funConfig.personaAutonomyContextMessages) || 6));
  const maxContextChars = Math.max(500, Math.min(8_000, Number(funConfig.personaAutonomyContextMaxChars) || 2_400));
  const immediate = Array.isArray(responseContextPack?.immediateContext)
    ? responseContextPack.immediateContext.slice(-maxContextMessages)
    : [];
  const history = [];
  let usedChars = 0;
  for (const item of immediate) {
    const line = sanitizeContextMessage(item, 420);
    if (!line || usedChars + line.length > maxContextChars) continue;
    history.push(line);
    usedChars += line.length;
  }

  const identity = responseContextPack?.groupIdentity || {};
  const facts = [...(responseContextPack?.confirmedFacts || []), ...(responseContextPack?.loreFacts || [])]
    .map((fact) => factText(fact, 180))
    .filter(Boolean)
    .slice(0, 5);
  const signals = (responseContextPack?.socialSignals || [])
    .map((signal) => cleanPromptText(memorySignalText(signal), 180))
    .filter(Boolean)
    .slice(0, 4);

  return [
    '<persona>',
    `nome: ${cleanPromptText(identity.botName || 'bot', 80) || 'bot'}`,
    identity.botRole ? `papel: ${cleanPromptText(identity.botRole, 180)}` : '',
    Array.isArray(identity.botTraits) && identity.botTraits.length ? `traços: ${identity.botTraits.map((trait) => cleanPromptText(trait, 60)).filter(Boolean).join(', ')}` : '',
    Array.isArray(identity.voiceStyle) && identity.voiceStyle.length ? `voz do grupo: ${identity.voiceStyle.map((style) => cleanPromptText(style, 60)).filter(Boolean).join(', ')}` : '',
    identity.groupLoreSummary ? `lore: ${cleanPromptText(identity.groupLoreSummary, 500)}` : '',
    '</persona>',
    '<conversa_recente>',
    history.join('\n') || '(sem histórico suficiente)',
    '</conversa_recente>',
    responseContextPack?.threadContext?.topicSummary ? `<tópico>${cleanPromptText(responseContextPack.threadContext.topicSummary, 280)}</tópico>` : '',
    facts.length ? `<fatos_confirmados>\n${facts.map((fact) => `- ${fact}`).join('\n')}\n</fatos_confirmados>` : '',
    signals.length ? `<sinais_sociais>\n${signals.map((signal) => `- ${signal}`).join('\n')}\n</sinais_sociais>` : '',
    '<mensagem_atual>',
    `${cleanPromptText(authorLabel || 'membro', 60) || 'membro'}: ${cleanPromptText(text, 700)}`,
    '</mensagem_atual>',
    `<stickers_autorizados>${STICKER_SLUGS.join(', ')}</stickers_autorizados>`,
  ].filter(Boolean).join('\n');
}

function buildBatchPromptContext({ batch, contextCount, responseContextPack, funConfig }) {
  const maxContextChars = Math.max(2_000, Math.min(32_000, Number(funConfig.personaAutonomyContextMaxChars) || 16_000));
  const formattedMessages = [];
  let usedChars = 0;

  for (let index = 0; index < batch.length; index += 1) {
    const item = batch[index];
    const role = index < contextCount ? 'CONTEXTO' : 'NOVA';
    const author = cleanPromptText(item?.authorLabel || 'membro', 60) || 'membro';
    const text = cleanPromptText(item?.text, 360);
    const line = `[${index}] ${role} · ${author}: ${text}`;
    if (!text || usedChars + line.length > maxContextChars) continue;
    formattedMessages.push(line);
    usedChars += line.length;
  }

  const identity = responseContextPack?.groupIdentity || {};
  const facts = [...(responseContextPack?.confirmedFacts || []), ...(responseContextPack?.loreFacts || [])]
    .map((fact) => factText(fact, 180))
    .filter(Boolean)
    .slice(0, 5);
  const signals = (responseContextPack?.socialSignals || [])
    .map((signal) => cleanPromptText(memorySignalText(signal), 180))
    .filter(Boolean)
    .slice(0, 4);

  return [
    '<persona>',
    `nome: ${cleanPromptText(identity.botName || 'bot', 80) || 'bot'}`,
    identity.botRole ? `papel: ${cleanPromptText(identity.botRole, 180)}` : '',
    Array.isArray(identity.botTraits) && identity.botTraits.length ? `traços: ${identity.botTraits.map((trait) => cleanPromptText(trait, 60)).filter(Boolean).join(', ')}` : '',
    Array.isArray(identity.voiceStyle) && identity.voiceStyle.length ? `voz do grupo: ${identity.voiceStyle.map((style) => cleanPromptText(style, 60)).filter(Boolean).join(', ')}` : '',
    identity.groupLoreSummary ? `lore: ${cleanPromptText(identity.groupLoreSummary, 500)}` : '',
    '</persona>',
    '<lote_mensagens>',
    formattedMessages.join('\n') || '(sem mensagens suficientes)',
    '</lote_mensagens>',
    responseContextPack?.threadContext?.topicSummary ? `<tópico>${cleanPromptText(responseContextPack.threadContext.topicSummary, 280)}</tópico>` : '',
    facts.length ? `<fatos_confirmados>\n${facts.map((fact) => `- ${fact}`).join('\n')}\n</fatos_confirmados>` : '',
    signals.length ? `<sinais_sociais>\n${signals.map((signal) => `- ${signal}`).join('\n')}\n</sinais_sociais>` : '',
    `<stickers_autorizados>${STICKER_SLUGS.join(', ')}</stickers_autorizados>`,
  ].filter(Boolean).join('\n');
}

function buildSystemPrompt(commentMaxChars, isBatch = false, contextCount = 0) {
  const batchGuidelines = isBatch
    ? [
        `As mensagens estão numeradas [0..N]. As primeiras ${contextCount} mensagens são CONTEXTO prévio e NUNCA devem receber reação.`,
        `Se escolher agir (react, sticker, comment), indique "target_message_index" com o índice da mensagem marcada como NOVA que motivou a ação (>= ${contextCount}).`,
        'Se passar ("action": "pass"), "target_message_index" deve ser null.',
      ]
    : [];

  return [
    'Você decide se uma persona deve participar espontaneamente de uma conversa de grupo no WhatsApp.',
    'O padrão correto é PASSAR: ficar em silêncio é melhor do que parecer spam. Em dúvida, use pass.',
    'Use pass em conversa séria, técnica, privada entre duas pessoas, conflito, assunto sensível, pedido de silêncio, assunto sem gancho ou quando a persona não acrescentaria algo marcante.',
    'Só considere agir numa piada claramente coletiva, celebração coletiva, meme/choque compartilhado, callback de lore realmente pertinente ou pergunta dirigida ao grupo que a persona possa enriquecer.',
    'Use a ação menos invasiva: react antes de sticker, sticker antes de comment. Comentário só se for uma frase realmente boa e curta.',
    ...batchGuidelines,
    `Comment deve ter no máximo ${commentMaxChars} caracteres. Não invente fatos, não faça ataques pessoais, não chame ferramentas e não alegue que executou uma ação.`,
    'React aceita exatamente um emoji. Sticker só pode usar um slug listado. Todas as propriedades do JSON são obrigatórias.',
    'Exemplo oportuno: a galera comemora uma vitória e um react 🎉 pode caber. Exemplo inoportuno: duas pessoas resolvendo um problema sério; use pass.',
    'Responda SOMENTE um objeto JSON válido no schema solicitado.',
  ].join('\n');
}

function buildUserPrompt(context, isBatch = false) {
  const targetExample = isBatch ? ',"target_message_index":null' : '';
  return `${context}\n\nResponda exatamente:\n{"action":"pass|react|sticker|comment"${targetExample},"score":0,"reason":"motivo interno curto","emoji":null,"stickerSlug":null,"commentText":null}`;
}

export function createPersonaOpportunityDetector({
  autonomyPolicy,
  generateZen,
  getLogger = () => null,
  clock = () => Date.now(),
} = {}) {
  if (!autonomyPolicy?.evaluate) throw new Error('[fun/personaOpportunityDetector] autonomyPolicy required');
  if (typeof generateZen !== 'function') throw new Error('[fun/personaOpportunityDetector] generateZen required');

  const logger = getLogger();
  const buffers = new Map();

  function bufferFor(scopeKey) {
    const scope = String(scopeKey || '');
    if (!buffers.has(scope)) {
      buffers.set(scope, {
        messages: [],
        contextTail: [],
        flushing: false,
        lastFlushAt: 0,
      });
    }
    return buffers.get(scope);
  }

  function getBuffer(scopeKey) {
    return bufferFor(scopeKey);
  }

  function clearBuffer(scopeKey) {
    const scope = String(scopeKey || '');
    buffers.delete(scope);
  }

  function observeMessage({
    scopeKey,
    text,
    authorLabel = '',
    authorJid = '',
    messageType = 'text',
    messageKey = null,
    quoteSource = null,
    funConfig = {},
    now = clock(),
  } = {}) {
    if (funConfig.personaAutonomyEnabled === false) return { observed: false, reason: 'disabled' };
    const scope = String(scopeKey || '');
    if (!scope.endsWith('@g.us')) return { observed: false, reason: 'not-group' };

    const body = String(text || '').trim();
    if (!body && messageType !== 'image' && messageType !== 'sticker') return { observed: false, reason: 'empty' };

    const buffer = bufferFor(scope);
    const batchSize = Math.max(1, Math.min(100, Number(funConfig.personaAutonomyBatchSize) || 40));
    const flushIntervalMs = Math.max(60_000, Number(funConfig.personaAutonomyFlushIntervalMs) || 30 * 60_000);
    const currentNow = Number(now) || clock();

    buffer.messages.push({
      text: body,
      authorLabel,
      authorJid,
      messageType,
      messageKey,
      quoteSource,
      at: currentNow,
    });

    const isTimeFlushed = buffer.messages.length >= 10 && buffer.lastFlushAt > 0 && (currentNow - buffer.lastFlushAt >= flushIntervalMs);
    const shouldFlush = buffer.messages.length >= batchSize || isTimeFlushed;

    return {
      observed: true,
      shouldFlush,
      count: buffer.messages.length,
    };
  }

  async function evaluateBatch({
    scopeKey,
    responseContextPack = null,
    funConfig = {},
    now = clock(),
  } = {}) {
    const scope = String(scopeKey || '');
    const buffer = bufferFor(scope);
    const batchSize = Math.max(1, Math.min(100, Number(funConfig.personaAutonomyBatchSize) || 40));
    const contextMessages = Math.max(0, Math.min(30, Number(funConfig.personaAutonomyBatchContextMessages) || 10));
    const flushIntervalMs = Math.max(60_000, Number(funConfig.personaAutonomyFlushIntervalMs) || 30 * 60_000);
    const currentNow = Number(now) || clock();

    if (funConfig.personaAutonomyEnabled === false) return { eligible: false, reason: 'disabled' };
    if (buffer.flushing) return { eligible: false, reason: 'busy' };

    const isTimeFlushed = buffer.messages.length >= 10 && buffer.lastFlushAt > 0 && (currentNow - buffer.lastFlushAt >= flushIntervalMs);
    if (buffer.messages.length < batchSize && !isTimeFlushed) {
      return { eligible: false, reason: 'buffering', count: buffer.messages.length };
    }

    const latestMessage = buffer.messages[buffer.messages.length - 1] || {};
    const immediateContext = responseContextPack?.immediateContext || [];
    const socialSignals = responseContextPack?.socialSignals || [];

    const preflight = autonomyPolicy.evaluate({
      scopeKey: scope,
      text: latestMessage.text || '',
      messageType: latestMessage.messageType || 'text',
      immediateContext,
      socialSignals,
      funConfig,
      currentNow,
    });

    if (!preflight?.eligible) {
      buffer.contextTail = buffer.messages.slice(-contextMessages);
      buffer.messages = [];
      buffer.lastFlushAt = currentNow;
      return { eligible: false, reason: preflight?.reason || 'blocked', score: preflight?.score || 0, action: null };
    }

    const isLiveLlmBlocked = process.env.FUN_DISABLE_LIVE_LLM === '1' && generateZen === openaiChatComplete;
    if (funConfig.personaAutonomyLlmEnabled === false || funConfig.zenEnabled === false || isLiveLlmBlocked) {
      buffer.contextTail = buffer.messages.slice(-contextMessages);
      buffer.messages = [];
      buffer.lastFlushAt = currentNow;
      return { eligible: false, reason: 'llm-disabled', score: preflight.score || 0, action: null };
    }

    buffer.flushing = true;
    const snapshot = buffer.messages.splice(0, batchSize);
    const context = buffer.contextTail.slice(-contextMessages);
    const batch = [...context, ...snapshot];
    const contextCount = context.length;

    const commentMaxChars = Math.max(40, Math.min(280, Number(funConfig.personaAutonomyCommentMaxChars) || 140));
    const zen = resolveZenTaskParams('persona_opportunity', funConfig);
    const endpoint = resolveZenEndpoint(funConfig);
    const prompt = buildUserPrompt(buildBatchPromptContext({ batch, contextCount, responseContextPack, funConfig }), true);

    try {
      const raw = await generateZen({
        baseUrl: endpoint.baseUrl,
        model: endpoint.model,
        apiKey: endpoint.apiKey,
        system: buildSystemPrompt(commentMaxChars, true, contextCount),
        prompt,
        timeoutMs: zen.timeoutMs,
        maxTokens: zen.maxTokens,
        temperature: zen.temperature,
        sendSamplingParams: funConfig.zenSendSamplingParams !== false,
        jsonMode: true,
        jsonOnly: true,
      });

      const parsed = parsePersonaOpportunityEnvelope(raw, {
        minScore: Math.max(0, Math.min(100, Number(funConfig.personaAutonomyMinScore) || 75)),
        allowed: allowedActions(funConfig),
        commentMaxChars,
        contextCount,
        batchLength: batch.length,
      });

      buffer.contextTail = snapshot.slice(-contextMessages);
      buffer.lastFlushAt = currentNow;

      if (!parsed.ok || !parsed.decision.outputAction) {
        return {
          eligible: false,
          reason: parsed.reason || 'pass',
          score: parsed.decision?.score || 0,
          action: null,
          targetMessage: null,
          llmReason: parsed.decision?.reason || '',
          count: snapshot.length,
        };
      }

      const targetIndex = parsed.decision.targetMessageIndex;
      const targetMessage = (targetIndex != null && batch[targetIndex])
        ? batch[targetIndex]
        : snapshot[snapshot.length - 1];

      return {
        eligible: true,
        reason: 'llm-opportunity',
        score: parsed.decision.score,
        action: parsed.decision.outputAction,
        targetMessage,
        llmReason: parsed.decision.reason,
        count: snapshot.length,
      };
    } catch (error) {
      buffer.messages.unshift(...snapshot);
      logger?.debug?.('[personaOpportunityDetector] Zen lote falhou scope=%s: %s (reencadeadas %d)', scope, String(error?.message || error), snapshot.length);
      return { eligible: false, reason: 'llm-error', score: 0, action: null, requeued: snapshot.length };
    } finally {
      buffer.flushing = false;
    }
  }

  async function evaluate({
    scopeKey,
    text,
    authorLabel = '',
    messageType = 'text',
    responseContextPack = null,
    funConfig = {},
    now = clock(),
  } = {}) {
    const currentNow = Number(now) || clock();
    const immediateContext = responseContextPack?.immediateContext || [];
    const socialSignals = responseContextPack?.socialSignals || [];
    const preflight = autonomyPolicy.evaluate({
      scopeKey,
      text,
      messageType,
      immediateContext,
      socialSignals,
      funConfig,
      currentNow,
    });
    if (!preflight?.eligible) return { eligible: false, reason: preflight?.reason || 'blocked', score: preflight?.score || 0, action: null };

    const minMessages = Math.max(0, Math.min(20, Number(funConfig.personaAutonomyCandidateMinMessages) || 2));
    if (!isCandidate({ text, messageType, immediateContext, minMessages })) {
      return { eligible: false, reason: 'no-opportunity-candidate', score: preflight.score || 0, action: null };
    }
    const isLiveLlmBlocked = process.env.FUN_DISABLE_LIVE_LLM === '1' && generateZen === openaiChatComplete;
    if (funConfig.personaAutonomyLlmEnabled === false || funConfig.zenEnabled === false || isLiveLlmBlocked) {
      return { eligible: false, reason: 'llm-disabled', score: preflight.score || 0, action: null };
    }

    const commentMaxChars = Math.max(40, Math.min(280, Number(funConfig.personaAutonomyCommentMaxChars) || 140));
    const zen = resolveZenTaskParams('persona_opportunity', funConfig);
    const endpoint = resolveZenEndpoint(funConfig);
    const prompt = buildUserPrompt(buildPromptContext({ text, authorLabel, responseContextPack, funConfig }));

    try {
      const raw = await generateZen({
        baseUrl: endpoint.baseUrl,
        model: endpoint.model,
        apiKey: endpoint.apiKey,
        system: buildSystemPrompt(commentMaxChars),
        prompt,
        timeoutMs: zen.timeoutMs,
        maxTokens: zen.maxTokens,
        temperature: zen.temperature,
        sendSamplingParams: funConfig.zenSendSamplingParams !== false,
        jsonMode: true,
        jsonOnly: true,
      });
      const parsed = parsePersonaOpportunityEnvelope(raw, {
        minScore: Math.max(0, Math.min(100, Number(funConfig.personaAutonomyMinScore) || 75)),
        allowed: allowedActions(funConfig),
        commentMaxChars,
      });
      if (!parsed.ok || !parsed.decision.outputAction) {
        return {
          eligible: false,
          reason: parsed.reason || 'pass',
          score: parsed.decision?.score || 0,
          action: null,
          llmReason: parsed.decision?.reason || '',
        };
      }
      return {
        eligible: true,
        reason: 'llm-opportunity',
        score: parsed.decision.score,
        action: parsed.decision.outputAction,
        llmReason: parsed.decision.reason,
      };
    } catch (error) {
      logger?.debug?.('[personaOpportunityDetector] Zen falhou scope=%s: %s', scopeKey, String(error?.message || error));
      return { eligible: false, reason: 'llm-error', score: 0, action: null };
    }
  }

  return {
    evaluate,
    observeMessage,
    evaluateBatch,
    getBuffer,
    clearBuffer,
  };
}
