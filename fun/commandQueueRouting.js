import { isPerActorLlmCommand } from '../runtime/commandQueue.js';

function normalizeJid(value) {
  return String(value ?? '').trim();
}

export function resolveCommandQueueRouting({ chatJid, actorJid, commandText }) {
  const normalizedChatJid = normalizeJid(chatJid) || 'unknown';
  if (!isPerActorLlmCommand(commandText)) {
    return {
      key: normalizedChatJid,
      serializationKey: '',
    };
  }

  const normalizedActorJid = normalizeJid(actorJid) || normalizedChatJid;
  return {
    key: `${normalizedChatJid}:${normalizedActorJid}`,
    serializationKey: `llm:${normalizedChatJid}:${normalizedActorJid}`,
  };
}
