import { PERSONA_MEMORY_DEFAULTS } from '../constants.js';

const tokens = (text) => String(text || '').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [];

/**
 * Resolve apenas conversas vinculadas por uma citação/âncora real.
 *
 * Recência não é vínculo: usá-la aqui fazia toda mensagem normal renovar a
 * última thread do grupo e misturava conversas paralelas no prompt da persona.
 */
export function createThreadContextService({ threadContextRepository } = {}) {
  if (!threadContextRepository) throw new Error('[fun/threadContextService] threadContextRepository required');

  function resolve(event = {}) {
    const now = Number(event.occurredAt) || Date.now();
    const scopeKey = String(event.scopeKey || '');
    const reply = String(event.quotedMessageId || '').trim();
    if (!reply) return { thread: null, source: 'none' };

    const thread = threadContextRepository.getByMessage(scopeKey, reply, { now });
    return { thread, source: thread ? 'reply' : 'unmatched-reply' };
  }

  function observe(event = {}, thread = null) {
    if (!thread?.threadKey) return null;
    const now = Number(event.occurredAt) || Date.now();
    return threadContextRepository.upsert({
      scopeKey: event.scopeKey,
      threadKey: thread.threadKey,
      anchorMessageId: thread.anchorMessageId || event.quotedMessageId,
      replyToMessageId: event.quotedMessageId,
      participants: [...new Set([event.authorJid, ...(event.mentionedJids || []), ...(thread.participants || [])].filter(Boolean))],
      topicSummary: tokens(event.text).slice(0, 8).join(' ') || thread.topicSummary,
      lastUserJid: event.authorJid,
      turnCount: (thread.turnCount || 0) + 1,
      now,
      expiresAt: now + (Number(event.threadTtlMs) || PERSONA_MEMORY_DEFAULTS.threadTtlMs),
    });
  }

  function anchorResponse(input = {}) {
    return threadContextRepository.anchorResponse(input);
  }

  return { resolve, observe, anchorResponse };
}
