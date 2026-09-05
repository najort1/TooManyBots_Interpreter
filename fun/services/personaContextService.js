import { cleanPromptText } from './personaPromptBuilder.js';

function selectImmediateContext({ repository, event, funConfig }) {
  if (!repository?.listRecentBefore || funConfig?.personaImmediateContextEnabled === false) return [];

  const messages = repository.listRecentBefore(event.scopeKey, {
    beforeAt: event.occurredAt,
    beforeMessageId: event.messageId,
    windowMs: funConfig?.personaImmediateContextWindowMs,
    limit: funConfig?.personaImmediateContextMessages,
  });
  const maxChars = Math.max(1_000, Number(funConfig?.personaImmediateContextMaxChars) || 16_000);
  const selected = [];
  let chars = 0;

  for (const message of [...messages].reverse()) {
    const text = cleanPromptText(message.text, 4_000);
    if (!text) continue;
    const quotedText = cleanPromptText(message.quotedText, 800);
    const itemChars = text.length + quotedText.length;
    if (selected.length && chars + itemChars > maxChars) break;
    selected.push({ ...message, text, quotedText });
    chars += itemChars;
  }

  return selected.reverse();
}

export function createPersonaContextService({
  threadContextService,
  memoryRetrievalService,
  personaIdentityService,
  personaRecentMessageRepository = null,
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
          now: event.occurredAt,
        });
        if (lore) identity.groupLoreSummary = lore;
      } else if (identity && groupMemoryService?.getPersonaCached) {
        const persona = groupMemoryService.getPersonaCached(event.scopeKey) || {};
        const personaText = String(persona.personaText || '').trim();
        if (personaText) identity.groupLoreSummary = personaText;
      }

      const loreFacts = memoryRepository?.listFacts
        ? memoryRepository.listFacts(event.scopeKey, { limit: 100, minScore: 0 })
        : [];
      const immediateContext = selectImmediateContext({
        repository: personaRecentMessageRepository,
        event,
        funConfig: event.funConfig || {},
      });

      const pack = {
        scopeKey: event.scopeKey,
        threadContext: resolved.thread,
        immediateContext,
        groupIdentity: identity,
        ...result,
        loreFacts,
        threadSource: resolved.source,
      };

      getLogger()?.debug?.(
        '[persona-context] scope=%s thread=%s recent=%d memories=%d loreFacts=%d',
        event.scopeKey,
        resolved.source,
        immediateContext.length,
        pack.selectedMemoryIds.length,
        loreFacts.length
      );

      return pack;
    } catch (err) {
      getLogger()?.warn?.('[persona-context] fallback: %s', String(err?.message || err));
      return {
        scopeKey: event.scopeKey,
        threadContext: null,
        immediateContext: [],
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
