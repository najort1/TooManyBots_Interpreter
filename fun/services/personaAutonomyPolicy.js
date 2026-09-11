import { isWorldQuietHours } from '../utils/worldQuietHours.js';

const DEFAULTS = Object.freeze({
  mode: 'explicit',
  minScore: 7,
  cooldownMs: 15 * 60_000,
  maxPerHour: 2,
  maxPerDay: 8,
  maxConsecutive: 1,
  negativeSignalBlockMs: 20 * 60_000,
  causalityWindowMs: 15 * 60_000,
});

const FALSE_STOP_RE = /\b(?:n[aã]o\s+par[ae]|nunca\s+par[ae]|sem\s+parar|parar?\s+de\s+sumir|para\s+de\s+(?:ser\s+)?(?:foda|bom|lindo|fofo|engra[cç]ado|legal|maravilhoso|carente|gra[cç]a)|quando\s+chega|chega\s+(?:a[ií]|mais)|vou\s+para|vai\s+para|olha\s+para|manda\s+para|passa\s+para)\b/iu;

const STOP_COMMAND_EXACT_RE = /^(?:para|pare|chega|cala|quiet[oa]|calad[oa]|sil[eê]ncio|shh+|shiu+)[!.,? ]*$/iu;

const STOP_PHRASES_RE = /\b(?:cala\s*(?:a\s*)?boca|calaboca|(?:fica|fique)\s+(?:quiet[oa]|calad[oa])|quiet[oa]\s+bot|(?:para|pare)\s+(?:bot|de\s+falar|de\s+responder|de\s+mandar|de\s+encher|por\s+favor|com\s+isso)|(?:chega\s+(?:bot|de\s+falar|de\s+responder|de\s+mandar|de\s+conversa))|(?:n[aã]o|nao)\s+(?:fala|responde)\s+(?:mais|nada|comigo)?|(?:sil[eê]ncio\s+bot))\b/iu;

export function hasStopRequest(text) {
  const clean = String(text || '').trim();
  if (!clean) return false;
  if (FALSE_STOP_RE.test(clean)) return false;
  return STOP_COMMAND_EXACT_RE.test(clean) || STOP_PHRASES_RE.test(clean);
}

function isSensitive(text) {
  return /\b(?:cpf|rg|senha|pix|cart[aã]o|endereço|endereco|telefone|n[uú]mero|morreu|suic[ií]dio|abuso)\b/iu.test(String(text || ''));
}

function normalizeMode(value) {
  return ['explicit', 'soft', 'natural', 'llm'].includes(value) ? value : DEFAULTS.mode;
}

/**
 * Decide se uma mensagem comum merece uma participação espontânea da persona.
 * A política só autoriza o turno; o modelo continua escolhendo texto, reação
 * ou sticker dentro do protocolo já existente.
 */
export function createPersonaAutonomyPolicy({ autonomyRepository = null, now = () => Date.now() } = {}) {
  const groupStates = new Map();

  function toState(raw = {}) {
    return {
      sentAt: Array.isArray(raw.actionTimestamps)
        ? raw.actionTimestamps
        : Array.isArray(raw.sentAt) ? raw.sentAt : [],
      lastAt: Number(raw.lastActionAt ?? raw.lastAt) || 0,
      consecutive: Math.max(0, Number(raw.consecutiveCount ?? raw.consecutive) || 0),
      negativeUntil: Math.max(0, Number(raw.negativeUntil) || 0),
    };
  }

  function persistState(scopeKey, state, currentNow) {
    if (!autonomyRepository?.saveState) return;
    autonomyRepository.saveState(scopeKey, {
      lastActionAt: state.lastAt,
      actionTimestamps: state.sentAt,
      consecutiveCount: state.consecutive,
      negativeUntil: state.negativeUntil,
    }, { now: currentNow });
  }

  function readState(scopeKey, currentNow) {
    if (autonomyRepository?.getState) {
      const persisted = autonomyRepository.getState(scopeKey, { now: currentNow });
      if (persisted) return toState(persisted);
    }
    return getState(scopeKey);
  }

  function observeState(scopeKey, state) {
    groupStates.set(scopeKey, state);
    return state;
  }

  function getOptions(funConfig = {}) {
    return {
      mode: normalizeMode(funConfig.personaAutonomyMode),
      minScore: Math.max(1, Number(funConfig.personaAutonomyMinScore) || DEFAULTS.minScore),
      cooldownMs: Math.max(60_000, Number(funConfig.personaAutonomyCooldownMs) || DEFAULTS.cooldownMs),
      maxPerHour: Math.max(1, Number(funConfig.personaAutonomyMaxPerHour) || DEFAULTS.maxPerHour),
      maxPerDay: Math.max(1, Number(funConfig.personaAutonomyMaxPerDay) || DEFAULTS.maxPerDay),
      maxConsecutive: Math.max(1, Number(funConfig.personaAutonomyMaxConsecutive) || DEFAULTS.maxConsecutive),
      negativeSignalBlockMs: Math.max(60_000, Number(funConfig.personaAutonomyNegativeBlockMs) || DEFAULTS.negativeSignalBlockMs),
      causalityWindowMs: Math.max(60_000, Number(funConfig.personaAutonomyCausalityWindowMs) || DEFAULTS.causalityWindowMs),
    };
  }

  function getState(scopeKey) {
    let state = groupStates.get(scopeKey);
    if (!state) {
      state = { sentAt: [], lastAt: 0, consecutive: 0, negativeUntil: 0 };
      groupStates.set(scopeKey, state);
    }
    return state;
  }

  function evaluate({
    scopeKey,
    text,
    messageType = 'text',
    isCommand = false,
    mention = false,
    atMention = false,
    continuation = false,
    immediateContext = [],
    socialSignals = [],
    funConfig = {},
    currentNow = now(),
  } = {}) {
    const options = getOptions(funConfig);
    if (funConfig.personaAutonomyEnabled !== true || options.mode === 'explicit') {
      return { eligible: false, reason: 'disabled', score: 0 };
    }
    if (mention || atMention || continuation || isCommand) return { eligible: false, reason: 'explicit-flow', score: 0 };
    if (String(messageType).toLowerCase() === 'unknown' || !String(text || '').trim()) {
      return { eligible: false, reason: 'message-type', score: 0 };
    }
    if (isWorldQuietHours(funConfig, currentNow)) return { eligible: false, reason: 'quiet-hours', score: 0 };
    if (hasStopRequest(text)) return { eligible: false, reason: 'stop-request', score: 0 };
    if (isSensitive(text)) return { eligible: false, reason: 'sensitive', score: 0 };

    const state = observeState(scopeKey, readState(scopeKey, currentNow));
    if (state.negativeUntil > currentNow) return { eligible: false, reason: 'negative-signal', score: 0 };
    if (socialSignals.some((signal) => String(signal?.socialSignal || '').toLowerCase() === 'negative')) {
      return { eligible: false, reason: 'negative-social-signal', score: 0 };
    }
    if (state.lastAt && currentNow - state.lastAt < options.cooldownMs) return { eligible: false, reason: 'cooldown', score: 0 };
    if (state.consecutive >= options.maxConsecutive) return { eligible: false, reason: 'consecutive-limit', score: 0 };

    state.sentAt = state.sentAt.filter((at) => currentNow - at <= 24 * 60 * 60_000);
    const lastHour = state.sentAt.filter((at) => currentNow - at <= 60 * 60_000).length;
    if (lastHour >= options.maxPerHour) return { eligible: false, reason: 'hour-budget', score: 0 };
    if (state.sentAt.length >= options.maxPerDay) return { eligible: false, reason: 'day-budget', score: 0 };

    const lower = String(text || '').toLowerCase();
    let score = 0;
    if (/\?/.test(lower)) score += 2;
    if (/\b(?:kkkk|kkk|meme|olha isso|socorro|mds|meu deus|parab[eé]ns|feliz anivers[aá]rio)\b/iu.test(lower)) score += 2;
    if (immediateContext.length >= 3) score += 1;
    if (/(?:\b(?:quem|qual|algu[eé]m|voc[eê]s|gente)\b.*\?)/iu.test(lower)) score += 2;
    if (options.mode === 'soft') return { eligible: false, reason: 'soft-no-strong-continuation', score };
    if (options.mode === 'llm') return { eligible: true, reason: 'llm-preflight', score };
    return score >= options.minScore
      ? { eligible: true, reason: 'natural-score', score }
      : { eligible: false, reason: 'low-score', score };
  }

  function recordSent(scopeKey, currentNow = now()) {
    const state = observeState(scopeKey, readState(scopeKey, currentNow));
    state.sentAt = state.sentAt.filter((at) => currentNow - at <= 24 * 60 * 60_000);
    state.sentAt.push(currentNow);
    state.lastAt = currentNow;
    state.consecutive += 1;
    persistState(scopeKey, state, currentNow);
  }

  function observeHumanMessage(scopeKey, {
    text,
    quotedIsBot = false,
    funConfig = {},
    currentNow = now(),
  } = {}) {
    const state = observeState(scopeKey, readState(scopeKey, currentNow));
    state.consecutive = 0;

    const options = getOptions(funConfig);
    const hadRecentAutonomousAction = Boolean(
      state.lastAt &&
      (currentNow - state.lastAt) <= options.causalityWindowMs
    );

    if (hadRecentAutonomousAction && quotedIsBot && hasStopRequest(text)) {
      state.negativeUntil = currentNow + options.negativeSignalBlockMs;
    }
    persistState(scopeKey, state, currentNow);
  }

  return { evaluate, recordSent, observeHumanMessage, _states: groupStates };
}
