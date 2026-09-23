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
  if (value === null || value === undefined) return true;
  const str = String(value).trim().toLowerCase();
  return str === '' || str === 'null' || str === 'none' || str === 'undefined';
}

function extractFirstEmoji(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  if (EMOJI_RE.test(text)) return text;
  const match = text.match(/\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*/u);
  return match ? match[0] : '';
}

/** Faz parse resiliente da decisão da persona autônoma. */
export function parsePersonaOpportunityEnvelope(raw, {
  minScore = 60,
  allowed = ALLOWED_ACTIONS,
  commentMaxChars = 140,
  contextCount = 0,
  batchLength = 1,
} = {}) {
  const value = jsonObject(raw);
  if (!value) return { ok: false, reason: 'invalid-json' };

  if (!('action' in value) || !('score' in value) || !('reason' in value)) {
    return { ok: false, reason: 'invalid-shape' };
  }

  const action = String(value.action || '').trim().toLowerCase();
  const rawScore = value.score;
  const numericScore = typeof rawScore === 'number' && Number.isFinite(rawScore)
    ? Math.round(rawScore)
    : typeof rawScore === 'string' && /^\d+$/.test(rawScore.trim())
      ? Number.parseInt(rawScore.trim(), 10)
      : null;

  if (!ACTIONS.has(action) || numericScore === null || numericScore < 0 || numericScore > 100) {
    return { ok: false, reason: 'invalid-decision' };
  }

  const reason = String(value.reason || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 160);
  if (!reason) return { ok: false, reason: 'missing-reason' };

  const rawIndex = value.target_message_index ?? value.targetMessageIndex;
  let targetIndex = null;
  const parsedIndex = typeof rawIndex === 'number' && Number.isInteger(rawIndex)
    ? rawIndex
    : typeof rawIndex === 'string' && /^\d+$/.test(rawIndex.trim())
      ? Number.parseInt(rawIndex.trim(), 10)
      : null;

  if (parsedIndex !== null) {
    if (parsedIndex >= contextCount && parsedIndex < batchLength) {
      targetIndex = parsedIndex;
    }
  }

  if (action === 'pass') {
    return { ok: true, decision: { action, score: numericScore, reason, targetMessageIndex: null, outputAction: null } };
  }

  if (!allowed.has(action)) return { ok: false, reason: 'action-disabled' };
  if (numericScore < minScore) return { ok: false, reason: 'low-score', score: numericScore };

  if (action === 'react') {
    const rawEmoji = String(value.emoji || '').trim();
    const emoji = extractFirstEmoji(rawEmoji);
    if (!emoji) {
      return { ok: false, reason: 'invalid-react' };
    }
    return { ok: true, decision: { action, score: numericScore, reason, targetMessageIndex: targetIndex, outputAction: { type: 'react', emoji } } };
  }

  if (action === 'sticker') {
    const slug = String(value.stickerSlug || '').trim();
    if (!STICKER_SLUGS.includes(slug)) {
      return { ok: false, reason: 'invalid-sticker' };
    }
    return { ok: true, decision: { action, score: numericScore, reason, targetMessageIndex: targetIndex, outputAction: { type: 'sticker', slug } } };
  }

  const text = cleanShortText(value.commentText, commentMaxChars);
  if (!text) {
    return { ok: false, reason: 'invalid-comment' };
  }
  return { ok: true, decision: { action, score: numericScore, reason, targetMessageIndex: targetIndex, outputAction: { type: 'text', text } } };
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

function extractGroupFacts(responseContextPack) {
  const seenFacts = new Set();
  const allRawFacts = [
    ...(responseContextPack?.confirmedFacts || []),
    ...(responseContextPack?.loreFacts || []),
  ];
  const facts = [];
  for (const fact of allRawFacts) {
    const text = factText(fact, 280);
    if (!text || seenFacts.has(text)) continue;
    seenFacts.add(text);
    facts.push(text);
  }
  return facts;
}

function extractSocialHints({ responseContextPack, personaSocialHintService, scopeKey, minConfidence = 45 } = {}) {
  const candidateHints = [];

  if (scopeKey && typeof personaSocialHintService?.getHints === 'function') {
    try {
      const fromService = personaSocialHintService.getHints(scopeKey, { limit: 90 });
      if (Array.isArray(fromService)) candidateHints.push(...fromService);
    } catch {
      // observacional
    }
  }

  if (Array.isArray(responseContextPack?.socialHints)) {
    candidateHints.push(...responseContextPack.socialHints);
  }

  if (Array.isArray(responseContextPack?.socialSignals)) {
    candidateHints.push(...responseContextPack.socialSignals);
  }

  const hintsBySignal = new Map([
    ['positive', []],
    ['neutral', []],
    ['negative', []],
  ]);

  const seenTexts = new Set();
  for (const item of candidateHints) {
    if (!item) continue;
    const rawSignal = String(item.socialSignal || item.signal || 'neutral').toLowerCase().trim();
    if (!hintsBySignal.has(rawSignal)) continue;

    const confidence = Number(item.confidence);
    const hasConfidence = Number.isFinite(confidence);
    if (hasConfidence && confidence < minConfidence) continue;

    const hintText = cleanPromptText(
      item.hintText || item.text || item.summary || memorySignalText(item),
      180
    );
    if (!hintText || seenTexts.has(`${rawSignal}:${hintText}`)) continue;
    seenTexts.add(`${rawSignal}:${hintText}`);

    hintsBySignal.get(rawSignal).push({
      socialSignal: rawSignal,
      confidence: hasConfidence ? confidence : 75,
      updatedAt: Number(item.updatedAt || item.at || 0),
      hintText,
    });
  }

  // Igual à persona: 10 de cada tipo (positive, neutral, negative), ordenados por confiança desc e updatedAt desc
  const selectedHints = [...hintsBySignal.entries()].flatMap(([socialSignal, hints]) =>
    hints
      .sort((a, b) => b.confidence - a.confidence || b.updatedAt - a.updatedAt)
      .slice(0, 10)
  );

  return selectedHints.map((hint) => `- [${hint.socialSignal} · confiança ${Math.round(hint.confidence)}] ${hint.hintText}`);
}

function buildPromptContext({ text, authorLabel, responseContextPack, funConfig, scopeKey = '', personaSocialHintService = null }) {
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
  const facts = extractGroupFacts(responseContextPack);
  const signals = extractSocialHints({
    responseContextPack,
    personaSocialHintService,
    scopeKey,
    minConfidence: funConfig?.personaSocialHintsMinConfidence ?? 45,
  });

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
    signals.length ? `<sinais_sociais>\n${signals.join('\n')}\n</sinais_sociais>` : '',
    '<mensagem_atual>',
    `${cleanPromptText(authorLabel || 'membro', 60) || 'membro'}: ${cleanPromptText(text, 700)}`,
    '</mensagem_atual>',
    `<stickers_autorizados>${STICKER_SLUGS.join(', ')}</stickers_autorizados>`,
  ].filter(Boolean).join('\n');
}

function buildBatchPromptContext({ batch, contextCount, responseContextPack, funConfig, scopeKey = '', personaSocialHintService = null }) {
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
  const facts = extractGroupFacts(responseContextPack);
  const signals = extractSocialHints({
    responseContextPack,
    personaSocialHintService,
    scopeKey,
    minConfidence: funConfig?.personaSocialHintsMinConfidence ?? 45,
  });

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
    signals.length ? `<sinais_sociais>\n${signals.join('\n')}\n</sinais_sociais>` : '',
    `<stickers_autorizados>${STICKER_SLUGS.join(', ')}</stickers_autorizados>`,
  ].filter(Boolean).join('\n');
}

function buildSystemPrompt(commentMaxChars, isBatch = false, contextCount = 0) {
  const batchGuidelines = isBatch
    ? [
        `As mensagens estão numeradas [0..N]. As primeiras ${contextCount} mensagens são CONTEXTO prévio e NUNCA devem receber ação.`,
        `Se escolher agir (react, sticker, comment), indique "target_message_index" com o índice da mensagem marcada como NOVA que motivou a ação (>= ${contextCount}).`,
        'Se passar ("action": "pass"), "target_message_index" deve ser null.',
      ]
    : [];

  return [
    'Você decide se a persona do grupo deve participar espontaneamente de uma conversa de grupo no WhatsApp.',
    'Você é um membro vivo e autêntico do grupo, descontraído e participante.',
    'Quando agir (oportunidades reais de interação):',
    '- O assunto em discussão tem a ver com seus gostos, traços, lore ou opiniões conhecidas do grupo (ex.: games, GTA, piadas internas, zoeiras entre membros, temas recorrentes).',
    '- Há uma pergunta aberta, dúvida ou curiosidade dirigida ao grupo que você possa responder, opinar ou enriquecer.',
    '- Há um meme, piada, momento engraçado, comemoração, choque ou provocação bem-humorada onde um react ou comentário cabe perfeitamente.',
    '- Use "react" livremente para mensagens engraçadas, chocantes, absurdas ou comemorativas (é rápido, natural e simpático).',
    '- Use "comment" para dar uma resposta rápida, espirituosa, zoeira amigável ou opinião autêntica de membro.',
    'Quando passar ("action": "pass"):',
    '- O padrão correto é PASSAR quando a conversa for séria, técnica, privada entre duas pessoas resolvendo algo pessoal, conflito/briga real, assunto sensível ou sem qualquer gancho para você.',
    ...batchGuidelines,
    `Comment deve ter no máximo ${commentMaxChars} caracteres, escrito de forma descontraída como mensagem real de WhatsApp. Não invente fatos, não faça ataques pessoais e não chame ferramentas.`,
    'React aceita um emoji direto. Sticker só pode usar um slug listado. Todas as propriedades do JSON são obrigatórias.',
    'Escala de score (0 a 100):',
    '- 0 a 49: conversa desinteressante, privada ou séria -> escolha action "pass".',
    '- 60 a 74: boa oportunidade para reagir com emoji (react) ou mandar sticker.',
    '- 75 a 100: excelente oportunidade, conexão forte com o assunto/lore/fatos para comentário marcante (comment) ou reação de destaque.',
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
  personaSocialHintService = null,
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
      console.log(`[fun/autonomy] Preflight bloqueou lote em ${scope}: motivo=${preflight?.reason} (score=${preflight?.score || 0})`);
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
    const prompt = buildUserPrompt(buildBatchPromptContext({ batch, contextCount, responseContextPack, funConfig, scopeKey: scope, personaSocialHintService }), true);

    console.log(`[fun/autonomy] Avaliando lote no LLM para ${scope}: ${batch.length} msgs (${contextCount} contexto, ${snapshot.length} novas)...`);

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

      console.log(`[fun/autonomy] Resposta bruta da LLM para ${scope}: ${String(raw || '').trim()}`);

      const effectiveMinScore = Math.max(0, Math.min(100, Number(funConfig.personaAutonomyMinScore) || 60));
      const parsed = parsePersonaOpportunityEnvelope(raw, {
        minScore: effectiveMinScore,
        allowed: allowedActions(funConfig),
        commentMaxChars,
        contextCount,
        batchLength: batch.length,
      });

      buffer.contextTail = snapshot.slice(-contextMessages);
      buffer.lastFlushAt = currentNow;

      if (!parsed.ok) {
        console.warn(`[fun/autonomy] ⚠️ Envelope rejeitado pelo parser em ${scope}: motivo=${parsed.reason} (score=${parsed.score ?? 'N/A'})`);
      } else if (!parsed.decision.outputAction) {
        console.log(`[fun/autonomy] 💤 LLM decidiu PASSAR em ${scope}: score=${parsed.decision.score} motivo="${parsed.decision.reason}"`);
      } else {
        console.log(`[fun/autonomy] 🎯 OPORTUNIDADE APROVADA em ${scope}! Ação: ${parsed.decision.action.toUpperCase()} | Score: ${parsed.decision.score} (mínimo: ${effectiveMinScore}) | Motivo: "${parsed.decision.reason}" | Msg index: ${parsed.decision.targetMessageIndex}`);
      }

      logger?.info?.(
        '[personaOpportunityDetector] Avaliação lote scope=%s msgs=%d: action=%s score=%d reason="%s" targetIndex=%s ok=%s',
        scope,
        snapshot.length,
        parsed.ok ? parsed.decision?.action : (parsed.reason || 'invalid'),
        parsed.decision?.score ?? parsed.score ?? 0,
        parsed.decision?.reason || parsed.reason,
        parsed.decision?.targetMessageIndex ?? 'N/A',
        Boolean(parsed.ok && parsed.decision?.outputAction)
      );

      if (!parsed.ok) {
        logger?.warn?.(
          '[personaOpportunityDetector] Rejeição envelope lote scope=%s motivo=%s raw=%j',
          scope,
          parsed.reason,
          String(raw || '').slice(0, 200)
        );
      }

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
      buffer.lastFlushAt = currentNow;
      console.error(`[fun/autonomy] Erro na chamada ao LLM no lote para ${scope}: ${String(error?.message || error)} (reencadeadas ${snapshot.length} msgs)`);
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
    if (!preflight?.eligible) {
      console.log(`[fun/autonomy] Preflight bloqueou mensagem em ${scopeKey}: motivo=${preflight?.reason}`);
      return { eligible: false, reason: preflight?.reason || 'blocked', score: preflight?.score || 0, action: null };
    }

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
    const prompt = buildUserPrompt(buildPromptContext({ text, authorLabel, responseContextPack, funConfig, scopeKey, personaSocialHintService }));

    console.log(`[fun/autonomy] Avaliando mensagem única no LLM para ${scopeKey}: "${String(text || '').slice(0, 50)}"...`);

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

      console.log(`[fun/autonomy] Resposta bruta da LLM para ${scopeKey}: ${String(raw || '').trim()}`);

      const effectiveMinScore = Math.max(0, Math.min(100, Number(funConfig.personaAutonomyMinScore) || 60));
      const parsed = parsePersonaOpportunityEnvelope(raw, {
        minScore: effectiveMinScore,
        allowed: allowedActions(funConfig),
        commentMaxChars,
      });

      if (!parsed.ok) {
        console.warn(`[fun/autonomy] ⚠️ Envelope rejeitado pelo parser em ${scopeKey}: motivo=${parsed.reason}`);
      } else if (!parsed.decision.outputAction) {
        console.log(`[fun/autonomy] 💤 LLM decidiu PASSAR em ${scopeKey}: score=${parsed.decision.score} motivo="${parsed.decision.reason}"`);
      } else {
        console.log(`[fun/autonomy] 🎯 OPORTUNIDADE APROVADA em ${scopeKey}! Ação: ${parsed.decision.action.toUpperCase()} | Score: ${parsed.decision.score}`);
      }

      logger?.info?.(
        '[personaOpportunityDetector] Avaliação scope=%s: action=%s score=%d reason="%s" ok=%s',
        scopeKey,
        parsed.ok ? parsed.decision?.action : (parsed.reason || 'invalid'),
        parsed.decision?.score ?? parsed.score ?? 0,
        parsed.decision?.reason || parsed.reason,
        Boolean(parsed.ok && parsed.decision?.outputAction)
      );

      if (!parsed.ok) {
        logger?.warn?.(
          '[personaOpportunityDetector] Rejeição envelope scope=%s motivo=%s raw=%j',
          scopeKey,
          parsed.reason,
          String(raw || '').slice(0, 200)
        );
      }

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
      console.error(`[fun/autonomy] Erro na chamada ao LLM para ${scopeKey}: ${String(error?.message || error)}`);
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
