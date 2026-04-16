import { addConversationEvent } from '../db/index.js';

let enqueueConversationEvent = null;

export function configureConversationEventEmitter(handler = null) {
  enqueueConversationEvent = typeof handler === 'function' ? handler : null;
}

export function emitConversationEvent(event = {}) {
  if (enqueueConversationEvent) {
    enqueueConversationEvent(event);
    return;
  }
  addConversationEvent(event);
}
