const words = (text) => new Set(String(text || '').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []);

export function createMemoryRetrievalService({ conversationMemoryRepository, getLogger = () => null } = {}) {
  if (!conversationMemoryRepository) throw new Error('[fun/memoryRetrievalService] conversationMemoryRepository required');

  function retrieve({ scopeKey, text, threadContext, participants = [], now = Date.now(), limit = 8 } = {}) {
    const query = words(text);
    const discarded = [];
    const candidates = conversationMemoryRepository.listRankable({ scopeKey, now, limit: 200 });
    const ranked = candidates.map((memory) => {
      const overlap = memory.keywords.filter((keyword) => query.has(String(keyword).toLowerCase())).length;
      const participant = participants.includes(memory.subjectUserJid) || participants.includes(memory.targetUserJid) ? 0.25 : 0;
      const thread = threadContext?.threadKey && memory.threadKey === threadContext.threadKey ? 0.5 : 0;
      return { memory, score: memory.confidence + overlap * 0.15 + participant + thread };
    }).sort((a, b) => b.score - a.score || b.memory.lastSeenAt - a.memory.lastSeenAt);
    const selected = ranked.slice(0, Math.max(1, Number(limit) || 8));
    for (const { memory } of ranked.slice(selected.length)) discarded.push(`context-limit:${memory.id}`);
    const confirmedFacts = [];
    const inferredSignals = [];
    const socialSignals = [];
    for (const { memory } of selected) {
      if (memory.confirmationLevel === 'inferred') inferredSignals.push(memory);
      else if (memory.memoryType === 'social') socialSignals.push(memory);
      else confirmedFacts.push(memory);
    }
    const result = { confirmedFacts, inferredSignals, socialSignals, selectedMemoryIds: selected.map(({ memory }) => memory.id), discardReasons: discarded, riskFlags: [] };
    getLogger()?.debug?.({ scopeKey, selectedMemoryIds: result.selectedMemoryIds, discardReasons: discarded }, '[persona-memory] retrieval');
    return result;
  }

  function getMetrics({ scopeKey, text, threadContext, participants, now, limit } = {}) {
    const result = retrieve({ scopeKey, text, threadContext, participants, now, limit });
    return { scopeKey: String(scopeKey || ''), selectedCount: result.selectedMemoryIds.length, confirmedCount: result.confirmedFacts.length, inferredCount: result.inferredSignals.length, socialCount: result.socialSignals.length, discardedCount: result.discardReasons.length, replyContinuity: Boolean(threadContext?.threadKey && result.selectedMemoryIds.length), isolated: [...result.confirmedFacts, ...result.inferredSignals, ...result.socialSignals].every((memory) => memory.scopeKey === scopeKey) };
  }

  return { retrieve, getMetrics };
}
