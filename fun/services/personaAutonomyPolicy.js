import { isWorldQuietHours } from '../utils/worldQuietHours.js';

const DEFAULTS = Object.freeze({
  mode: 'explicit',
  minScore: 7,
  cooldownMs: 15 * 60_000,
  maxPerHour: 2,
  maxPerDay: 8,
  maxConsecutive: 1,
  negativeSignalBlockMs: 60 * 60_000,
});

function hasStopRequest(text) {
  return /\b(?:para|pare|chega|cala|quieto|não fala|nao fala|não responde|nao responde)\b/iu.test(String(text || ''));
}

function isSensitive(text) {
  return /\b(?:cpf|rg|senha|pix|cart[aã]o|endereço|endereco|telefone|n[uú]mero|morreu|suic[ií]dio|abuso)\b/iu.test(String(text || ''));
}

function normalizeMode(value) {
  return ['explicit', 'soft', 'natural'].includes(value) ? value : DEFAULTS.mode;
}

/**
 * Decide se uma mensagem comum merece uma participação espontânea da persona.
 * A política só autoriza o turno; o modelo continua escolhendo texto, reação
 * ou sticker dentro do protocolo já existente.
 */
export function createPersonaAutonomyPolicy({ now = () => Date.now() } = {}) {
  const groupStates = new Map();

  function getOptions(funConfig = {}) {
    return {
      mode: normalizeMode(funConfig.personaAutonomyMode),
      minScore: Math.max(1, Number(funConfig.personaAutonomyMinScore) || DEFAULTS.minScore),
      cooldownMs: Math.max(60_000, Number(funConfig.personaAutonomyCooldownMs) || DEFAULTS.cooldownMs),
      maxPerHour: Math.max(1, Number(funConfig.personaAutonomyMaxPerHour) || DEFAULTS.maxPerHour),
      maxPerDay: Math.max(1, Number(funConfig.personaAutonomyMaxPerDay) || DEFAULTS.maxPerDay),
      maxConsecutive: Math.max(1, Number(funConfig.personaAutonomyMaxConsecutive) || DEFAULTS.maxConsecutive),
      negativeSignalBlockMs: Math.max(60_000, Number(funConfig.personaAutonomyNegativeBlockMs) || DEFAULTS.negativeSignalBlockMs),
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

    const state = getState(scopeKey);
    if (state.negativeUntil > currentNow) return { eligible: false, reason: 'negative-signal', score: 0 };
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
    if (socialSignals.some((signal) => String(signal?.socialSignal || '').toLowerCase() === 'negative')) {
      return { eligible: false, reason: 'negative-social-signal', score };
    }
    if (options.mode === 'soft') return { eligible: false, reason: 'soft-no-strong-continuation', score };
    return score >= options.minScore
      ? { eligible: true, reason: 'natural-score', score }
      : { eligible: false, reason: 'low-score', score };
  }

  function recordSent(scopeKey, currentNow = now()) {
    const state = getState(scopeKey);
    state.sentAt.push(currentNow);
    state.lastAt = currentNow;
    state.consecutive += 1;
  }

  function observeHumanMessage(scopeKey, { text, currentNow = now() } = {}) {
    const state = getState(scopeKey);
    state.consecutive = 0;
    if (hasStopRequest(text)) state.negativeUntil = currentNow + DEFAULTS.negativeSignalBlockMs;
  }

  return { evaluate, recordSent, observeHumanMessage, _states: groupStates };
}
