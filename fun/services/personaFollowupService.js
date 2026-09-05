import { isWorldQuietHours } from '../utils/worldQuietHours.js';

function hasStopOrSensitiveSignal(text) {
  return /\b(?:para|pare|chega|cala|quieto|não fala|nao fala|não responde|nao responde|cpf|rg|senha|pix|cart[aã]o|endereço|endereco|telefone|suic[ií]dio|abuso)\b/iu.test(String(text || ''));
}

function options(funConfig = {}) {
  return {
    enabled: funConfig.personaFollowupEnabled !== false,
    silenceMs: Math.max(60_000, Number(funConfig.personaFollowupSilenceMs) || 60_000),
    candidateWindowMs: Math.max(60_000, Number(funConfig.personaFollowupCandidateWindowMs) || 30 * 60_000),
    maxCandidates: Math.max(1, Math.min(100, Number(funConfig.personaFollowupMaxCandidates) || 60)),
    maxContextChars: Math.max(4_000, Math.min(18_000, Number(funConfig.personaFollowupMaxContextChars) || 18_000)),
    leaseMs: Math.max(10_000, Number(funConfig.personaFollowupLeaseMs) || 90_000),
    maxRetries: Math.max(1, Math.min(10, Number(funConfig.personaFollowupMaxRetries) || 3)),
  };
}

function selectCandidates(messages, maxChars) {
  const selected = [];
  let used = 0;
  for (const message of messages) {
    const text = String(message?.text || '').trim();
    if (!text) continue;
    const remaining = maxChars - used;
    if (remaining < 180) break;
    const bounded = text.slice(0, Math.min(1_500, remaining));
    selected.push({ ...message, text: bounded });
    used += bounded.length + String(message?.authorLabel || '').length + 120;
  }
  return selected;
}

/** Coordena uma única avaliação pós-silêncio após resposta explicitamente chamada. */
export function createPersonaFollowupService({
  followupRepository,
  personaRecentMessageRepository,
  personaService,
  personaContextService = null,
  groupRepository,
  getLogger = () => null,
} = {}) {
  if (!followupRepository || !personaRecentMessageRepository || !personaService || !groupRepository) {
    throw new Error('[fun/personaFollowupService] dependencies required');
  }
  const logger = getLogger();

  function observePersonaResponse({ scopeKey, responseMessageIds = [], now = Date.now(), trigger = '' } = {}) {
    if (!['mention', 'at-mention', 'continuation'].includes(String(trigger))) {
      return { ok: false, reason: 'non-explicit-trigger' };
    }
    const anchorMessageId = String(responseMessageIds?.[0] || '').trim();
    return followupRepository.startTurn({ scopeKey, anchorMessageId, anchorAt: now, now });
  }

  function observeHumanMessage({ scopeKey, messageId, now = Date.now() } = {}) {
    return followupRepository.observeHumanMessage({ scopeKey, messageId, now });
  }

  async function tick({ sock, funConfig = {}, now = Date.now() } = {}) {
    const o = options(funConfig);
    if (!o.enabled || funConfig.personaEnabled === false) return [];
    if (isWorldQuietHours(funConfig, now)) return [];

    const due = followupRepository.listDue({ now, silenceMs: o.silenceMs });
    const results = [];
    for (const state of due) {
      const groupSettings = groupRepository.getGroupSettings(state.scopeKey);
      if (groupSettings?.personaEnabled === false) {
        followupRepository.complete({ scopeKey: state.scopeKey, expectedHumanMessageId: state.lastHumanMessageId, now });
        results.push({ scopeKey: state.scopeKey, kind: 'persona-followup', ok: false, reason: 'disabled-group' });
        continue;
      }
      if (state.attemptCount >= o.maxRetries) {
        followupRepository.complete({ scopeKey: state.scopeKey, expectedHumanMessageId: state.lastHumanMessageId, now });
        results.push({ scopeKey: state.scopeKey, kind: 'persona-followup', ok: false, reason: 'retry-limit' });
        continue;
      }
      const claimed = followupRepository.claim({
        scopeKey: state.scopeKey,
        expectedHumanMessageId: state.lastHumanMessageId,
        now,
        leaseMs: o.leaseMs,
      });
      if (!claimed.ok) continue;

      try {
        const messages = personaRecentMessageRepository.listHumanAfter(state.scopeKey, {
          afterAt: state.anchorAt,
          beforeAt: now,
          windowMs: o.candidateWindowMs,
          limit: o.maxCandidates,
        });
        const candidates = selectCandidates(messages, o.maxContextChars);
        if (!candidates.length || candidates.some((message) => hasStopOrSensitiveSignal(message.text))) {
          followupRepository.complete({ scopeKey: state.scopeKey, expectedHumanMessageId: state.lastHumanMessageId, now });
          results.push({ scopeKey: state.scopeKey, kind: 'persona-followup', ok: false, reason: candidates.length ? 'safety-signal' : 'no-candidates' });
          continue;
        }
        const newestId = String(candidates.at(-1)?.messageId || '');
        if (newestId !== state.lastHumanMessageId) {
          followupRepository.release({ scopeKey: state.scopeKey, reason: 'new-human-message', now });
          continue;
        }
        const selectedTarget = candidates.at(-1);
        const responseContextPack = personaContextService?.build?.({
          scopeKey: state.scopeKey,
          authorJid: selectedTarget.authorJid,
          text: selectedTarget.text,
          messageId: selectedTarget.messageId,
          mentionedJids: selectedTarget.mentionedJids || [],
          occurredAt: now,
          threadTtlMs: funConfig.personaThreadTtlMs,
          maxContextItems: funConfig.personaMemoryMaxContextItems,
          funConfig,
        }) || null;
        const response = await personaService.tryIdleFollowUp({
          scopeKey: state.scopeKey,
          candidates,
          sock,
          funConfig,
          groupSettings,
          responseContextPack,
          now,
        });
        const retryable = response?.reason === 'generation-or-send-error';
        if (retryable && state.attemptCount + 1 < o.maxRetries) {
          followupRepository.release({ scopeKey: state.scopeKey, reason: response.reason, now });
        } else {
          followupRepository.complete({ scopeKey: state.scopeKey, expectedHumanMessageId: state.lastHumanMessageId, now });
        }
        results.push({
          scopeKey: state.scopeKey,
          kind: 'persona-followup',
          ok: Boolean(response?.responded),
          reason: response?.reason || null,
          sourceMessageId: response?.sourceMessageId || null,
        });
      } catch (error) {
        followupRepository.release({ scopeKey: state.scopeKey, reason: String(error?.message || error), now });
        logger?.debug?.('[persona-followup] tick failed: %s', String(error?.message || error));
        results.push({ scopeKey: state.scopeKey, kind: 'persona-followup', ok: false, reason: 'error' });
      }
    }
    return results;
  }

  return { observePersonaResponse, observeHumanMessage, tick, _options: options };
}
