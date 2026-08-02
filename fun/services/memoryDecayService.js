const evidenceRank = { inferred: 1, explicit: 2, corroborated: 3 };

export function createMemoryDecayService({ conversationMemoryRepository } = {}) {
  if (!conversationMemoryRepository) throw new Error('[fun/memoryDecayService] conversationMemoryRepository required');

  function expireScope(scopeKey, now = Date.now()) {
    return conversationMemoryRepository.expire({ scopeKey, now });
  }

  function reconcile({ scopeKey, subjectUserJid, factKey, now = Date.now() } = {}) {
    const candidates = conversationMemoryRepository.listByFact({ scopeKey, subjectUserJid, factKey });
    if (candidates.length < 2) return { ok: true, winner: candidates[0] || null, suppressedIds: [] };
    const ordered = [...candidates].sort((left, right) => (
      evidenceRank[right.confirmationLevel] - evidenceRank[left.confirmationLevel]
      || right.lastSeenAt - left.lastSeenAt
      || right.confidence - left.confidence
      || left.id.localeCompare(right.id)
    ));
    const winner = ordered[0];
    const suppressedIds = ordered.slice(1).map((memory) => memory.id);
    for (const id of suppressedIds) conversationMemoryRepository.suppress({ scopeKey, id });
    return { ok: true, winner, suppressedIds };
  }

  return { expireScope, reconcile };
}
