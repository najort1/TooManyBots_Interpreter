export const CHAT_BUBBLE_TTL_MS = 7_000;
export const CHAT_BUBBLE_LIMIT = 5;

export function getVisibleChatMessages(messages, now = Date.now(), ttlMs = CHAT_BUBBLE_TTL_MS) {
  return messages
    .filter((message) => Number.isFinite(Number(message?.createdAt)) && now - Number(message.createdAt) < ttlMs)
    .slice(-CHAT_BUBBLE_LIMIT);
}
