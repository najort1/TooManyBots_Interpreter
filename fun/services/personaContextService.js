export function createPersonaContextService({
  threadContextService,
  memoryRetrievalService,
  personaIdentityService,
  groupMemoryService = null,
  memoryRepository = null,
  getLogger = () => null,
} = {}) {
  if (!threadContextService || !memoryRetrievalService || !personaIdentityService) {
    throw new Error('[fun/personaContextService] dependencies required');
  }

  function build(event = {}) {
    try {
      const resolved = threadContextService.resolve(event);
      const result = memoryRetrievalService.retrieve({
        scopeKey: event.scopeKey,
        text: event.text,
        threadContext: resolved.thread,
        participants: [event.authorJid, ...(event.mentionedJids || [])].filter(Boolean),
        now: event.occurredAt,
        limit: event.maxContextItems,
      });

      const identity = personaIdentityService.get(event.scopeKey);
      if (identity && groupMemoryService?.buildPersonaLoreContext) {
        const lore = groupMemoryService.buildPersonaLoreContext(event.scopeKey, {
          funConfig: event.funConfig || {},
        });
        if (lore) identity.groupLoreSummary = lore;
      } else if (identity && groupMemoryService?.getPersonaCached) {
        const persona = groupMemoryService.getPersonaCached(event.scopeKey) || {};
        const personaText = String(persona.personaText || '').trim();
        if (personaText) identity.groupLoreSummary = personaText;
      }

      // Carrega fatos brutos de lore para contextualizar menções e alvos
      let loreFacts = [];
      if (memoryRepository?.listFacts) {
        loreFacts = memoryRepository.listFacts(event.scopeKey, { limit: 100, minScore: 0 });
      }

      const pack = {
        scopeKey: event.scopeKey,
        threadContext: resolved.thread,
        groupIdentity: identity,
        ...result,
        loreFacts,
        threadSource: resolved.source,
      };

      getLogger()?.debug?.(
        '[persona-context] scope=%s thread=%s memories=%d loreFacts=%d',
        event.scopeKey,
        resolved.source,
        pack.selectedMemoryIds.length,
        loreFacts.length
      );

      return pack;
    } catch (err) {
      getLogger()?.warn?.('[persona-context] fallback: %s', String(err?.message || err));
      return {
        scopeKey: event.scopeKey,
        threadContext: null,
        confirmedFacts: [],
        inferredSignals: [],
        socialSignals: [],
        groupIdentity: null,
        discardReasons: ['context-error'],
        selectedMemoryIds: [],
        riskFlags: ['context-error'],
        loreFacts: [],
      };
    }
  }

  return { build };
}
