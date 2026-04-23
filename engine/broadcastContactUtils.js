import { LRUCache } from './utils.js';
import { BROADCAST_LIMITS } from '../config/constants.js';
import { getActiveSessions } from '../db/index.js';

function normalizeJid(value) {
  return String(value ?? '').trim();
}

function inferRecipientType(jid) {
  return String(jid || '').endsWith('@g.us') ? 'group' : 'individual';
}

function normalizeRecipientList(value, { knownRecipientsByJid = null } = {}) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];

  for (const item of value) {
    const inputJid = normalizeJid(typeof item === 'string' ? item : item?.jid);
    const known = knownRecipientsByJid?.get?.(inputJid) || null;
    const jid = normalizeJid(known?.jid || inputJid);
    if (!jid || seen.has(jid)) continue;
    seen.add(jid);
    const recipientTypeRaw = String(
      known?.recipientType
      || (typeof item === 'string' ? '' : item?.recipientType ?? '')
      || inferRecipientType(jid)
    )
      .trim()
      .toLowerCase();
    result.push({
      jid,
      recipientType: recipientTypeRaw === 'group' ? 'group' : 'individual',
    });
  }

  return result;
}

function summarizeRecipients(recipients = []) {
  let individuals = 0;
  let groups = 0;
  for (const recipient of recipients) {
    if (String(recipient?.recipientType || '').trim().toLowerCase() === 'group') {
      groups += 1;
    } else {
      individuals += 1;
    }
  }
  return {
    total: recipients.length,
    individuals,
    groups,
  };
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
  const knownRecipientsByJid = new Map(
    (Array.isArray(allContacts) ? allContacts : [])
      .map(contact => {
        const jid = normalizeJid(contact?.jid);
        if (!jid) return null;
        return [
          jid,
          {
            jid,
            recipientType: String(contact?.recipientType || '').trim().toLowerCase() === 'group' ? 'group' : inferRecipientType(jid),
          },
        ];
      })
      .filter(Boolean)
  );
  const normalizedTarget = String(target ?? '').trim().toLowerCase();
  if (normalizedTarget === 'selected') {
    const selected = normalizeRecipientList(selectedJids, { knownRecipientsByJid })
      .slice(0, BROADCAST_LIMITS.SELECTED_RECIPIENTS_MAX);
    return {
      target: 'selected',
      recipients: selected,
      recipientCounts: summarizeRecipients(selected),
    };
  }

  const recipients = normalizeRecipientList(allContacts, { knownRecipientsByJid })
    .slice(0, BROADCAST_LIMITS.CONTACT_LIST_MAX);
  return {
    target: 'all',
    recipients,
    recipientCounts: summarizeRecipients(recipients),
  };
}
