import { LRUCache } from './utils.js';
import { BROADCAST_LIMITS } from '../config/constants.js';
import { getActiveSessions } from '../db/index.js';

function normalizeJid(value) {
  return String(value ?? '').trim();
}

function normalizeJidList(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];

  for (const item of value) {
    const jid = normalizeJid(item);
    if (!jid || seen.has(jid)) continue;
    seen.add(jid);
    result.push(jid);
  }

  return result;
}

export function createActiveSessionLookup({
  maxSize = BROADCAST_LIMITS.ACTIVE_SESSION_CACHE_MAX,
  ttlMs = BROADCAST_LIMITS.ACTIVE_SESSION_CACHE_TTL_MS,
} = {}) {
  const cache = new LRUCache(maxSize, ttlMs);
  let lastRefreshAt = 0;

  function refresh() {
    const nowTs = Date.now();
    if (nowTs - lastRefreshAt < ttlMs) return;

    const active = getActiveSessions();
    for (const session of active) {
      const jid = normalizeJid(session?.jid);
      if (!jid) continue;
      cache.add(jid);
    }
    lastRefreshAt = nowTs;
  }

  return {
    has(jid) {
      const normalized = normalizeJid(jid);
      if (!normalized) return false;
      refresh();
      return cache.has(normalized);
    },
  };
}

export function resolveBroadcastSelection({
  target = 'all',
  selectedJids = [],
  allContacts = [],
}) {
  const normalizedTarget = String(target ?? '').trim().toLowerCase();
  if (normalizedTarget === 'selected') {
    const selected = normalizeJidList(selectedJids).slice(0, BROADCAST_LIMITS.SELECTED_RECIPIENTS_MAX);
    return {
      target: 'selected',
      recipients: selected,
    };
  }

  const recipients = normalizeJidList(allContacts.map(contact => contact?.jid)).slice(0, BROADCAST_LIMITS.CONTACT_LIST_MAX);
  return {
    target: 'all',
    recipients,
  };
}
