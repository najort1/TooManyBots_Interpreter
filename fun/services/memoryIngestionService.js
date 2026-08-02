import { PERSONA_MEMORY_DEFAULTS } from '../constants.js';

const preference = /\b(?:eu\s+)?(gosto|amo|prefiro|odeio)\s+(?:de\s+)?(.{2,80})/iu;
const inferredPreference = /\b(?:acho|parece|talvez)\s+(?:que\s+)?(?:eu\s+)?(gosto|amo|prefiro|odeio)\s+(?:de\s+)?(.{2,80})/iu;
const sensitive = /(senha|password|token|api[_-]?key|pix|cpf|telefone|celular|endereço|endereco)/iu;
const normalize = (value) => String(value || '').trim().replace(/[.!?]+$/g, '').toLowerCase();

export function createMemoryIngestionService({ conversationMemoryRepository, getLogger = () => null } = {}) {
  if (!conversationMemoryRepository) throw new Error('[fun/memoryIngestionService] conversationMemoryRepository required');

  function observe(event = {}) {
    const scopeKey = String(event.scopeKey || '');
    const authorJid = String(event.authorJid || '');
    const text = String(event.text || '').trim();
    if (!scopeKey || !authorJid || !text) return { ok: false, reason: 'no-memory-signal' };
    if (sensitive.test(text)) return { ok: false, reason: 'sensitive' };

    const now = Number(event.occurredAt) || Date.now();
    const inferred = text.match(inferredPreference);
    const explicit = !inferred && text.match(preference);
    const mentionedJids = [...new Set((event.mentionedJids || []).map(String).filter(Boolean))];
    let memory;

    if (explicit || inferred) {
      const match = explicit || inferred;
      const subject = normalize(match[2]);
      const factKey = `preference:${subject}`;
      const existing = conversationMemoryRepository.listRankable({ scopeKey, now, limit: 200 })
        .find((item) => item.subjectUserJid === authorJid && item.factKey === factKey && item.factText === `${match[1].toLowerCase()}:${subject}`);
      memory = existing
        ? conversationMemoryRepository.reinforce({
          scopeKey,
          id: existing.id,
          confidence: explicit ? 1 : Math.max(existing.confidence, 0.45),
          confirmationLevel: explicit && existing.confirmationLevel === 'explicit' ? 'corroborated' : existing.confirmationLevel,
          now,
        })
        : conversationMemoryRepository.create({
          scopeKey,
          memoryType: 'semantic',
          subjectUserJid: authorJid,
          threadKey: event.threadKey,
          relatedMessageId: event.messageId,
          factText: `${match[1].toLowerCase()}:${subject}`,
          factKey,
          confidence: explicit ? 0.9 : 0.45,
          confirmationLevel: explicit ? 'explicit' : 'inferred',
          sensitivityLevel: 'safe',
          sourceType: 'chat',
          keywords: subject.split(/\s+/),
          entities: [authorJid],
          now,
          expiresAt: now + PERSONA_MEMORY_DEFAULTS.semanticTtlMs,
        });
    } else if (mentionedJids.length) {
      const factKey = `social:${[authorJid, ...mentionedJids].sort().join(':')}`;
      const existing = conversationMemoryRepository.listRankable({ scopeKey, now, limit: 200 })
        .find((item) => item.factKey === factKey);
      memory = existing
        ? conversationMemoryRepository.reinforce({ scopeKey, id: existing.id, confidence: 0.6, confirmationLevel: 'corroborated', now })
        : conversationMemoryRepository.create({
          scopeKey, memoryType: 'social', subjectUserJid: authorJid, targetUserJid: mentionedJids[0], threadKey: event.threadKey,
          relatedMessageId: event.messageId, factText: 'interação social no grupo', factKey, confidence: 0.55, confirmationLevel: 'inferred',
          sensitivityLevel: 'safe', sourceType: 'chat', keywords: ['interação', 'grupo'], entities: [authorJid, ...mentionedJids], now,
          expiresAt: now + PERSONA_MEMORY_DEFAULTS.episodicTtlMs,
        });
    } else {
      const factKey = `episode:${String(event.messageId || `${authorJid}:${normalize(text)}`).slice(0, 120)}`;
      const existing = conversationMemoryRepository.listRankable({ scopeKey, now, limit: 200 }).find((item) => item.factKey === factKey);
      memory = existing
        ? conversationMemoryRepository.reinforce({ scopeKey, id: existing.id, confidence: 0.5, confirmationLevel: existing.confirmationLevel, now })
        : conversationMemoryRepository.create({
          scopeKey, memoryType: 'episodic', subjectUserJid: authorJid, threadKey: event.threadKey, relatedMessageId: event.messageId,
          factText: 'evento recente do grupo', factKey, confidence: 0.4, confirmationLevel: 'inferred', sensitivityLevel: 'safe', sourceType: 'chat',
          keywords: normalize(text).split(/\s+/).filter((word) => word.length >= 3).slice(0, 8), entities: [authorJid], now,
          expiresAt: now + PERSONA_MEMORY_DEFAULTS.episodicTtlMs,
        });
    }
    getLogger()?.debug?.({ scopeKey, action: memory.memory?.usageCount ? 'reinforce' : 'create', memoryId: memory.memory?.id }, '[persona-memory] ingestion');
    return memory;
  }

  return { observe };
}
