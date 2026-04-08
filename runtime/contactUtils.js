import { listConversationEvents, onConversationEvent } from '../db/index.js';

export function getMessageDebugInfo(msg, type) {
  const key = msg.key ?? {};
  const remoteJid = key.remoteJid ?? '';
  const senderPn = key.senderPn ?? '';
  const participant = key.participant ?? '';
  const fromMe = Boolean(key.fromMe);
  const hasMessage = Boolean(msg.message);
  const messageKeys = hasMessage ? Object.keys(msg.message) : [];
  let dropReason = '';
  if (fromMe) dropReason = 'fromMe';
  else if (!remoteJid) dropReason = 'missingRemoteJid';
  else if (remoteJid === 'status@broadcast') dropReason = 'statusBroadcast';
  else if (!hasMessage) dropReason = 'missingMessage';
  return {
    type,
    remoteJid,
    senderPn,
    participant,
    fromMe,
    hasMessage,
    messageKeys,
    dropReason,
  };
}

export function normalizeInteractionScope(flow) {
  return String(flow?.runtimeConfig?.interactionScope ?? 'all').toLowerCase();
}

export function isGroupWhitelistScope(flow) {
  const scope = normalizeInteractionScope(flow);
  return scope.includes('group-whitelist') || scope.includes('whitelist-group');
}

export function shouldProcessByInteractionScope(isGroup, flow) {
  const scope = normalizeInteractionScope(flow);

  if (!scope || scope === 'all' || scope === 'any' || scope === 'all-users-groups') {
    return true;
  }

  const mentionsGroup = scope.includes('group');
  const mentionsUser = scope.includes('user') || scope.includes('private') || scope.includes('direct');

  if (mentionsGroup && !mentionsUser) return isGroup;
  if (mentionsUser && !mentionsGroup) return !isGroup;
  return true;
}

export function toJidString(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'object') {
    if (typeof value.remoteJid === 'string') return value.remoteJid.trim();
    if (typeof value.jid === 'string') return value.jid.trim();
    if (typeof value.id === 'string') return value.id.trim();
  }
  return '';
}

function extractPersonJidFromMessageKey(messageKey = {}) {
  const candidates = [
    messageKey.participantPn,
    messageKey.senderPn,
    messageKey.participant,
    messageKey.senderJid,
  ];

  for (const candidate of candidates) {
    const jid = toJidString(candidate);
    if (jid.endsWith('@s.whatsapp.net')) return jid;
  }

  return '';
}

export function resolveIncomingActorJid(parsed) {
  const keyJid = extractPersonJidFromMessageKey(parsed?.messageKey ?? {});
  if (keyJid) return keyJid;

  const parsedJid = toJidString(parsed?.jid);
  if (!parsed?.isGroup && parsedJid) return parsedJid;

  return '';
}

function toJidSet(values = []) {
  const set = new Set();
  for (const value of values) {
    const jid = toJidString(value);
    if (jid) set.add(jid);
  }
  return set;
}

export function isUserJid(jid) {
  return String(jid ?? '').endsWith('@s.whatsapp.net');
}

export function isGroupJid(jid) {
  return String(jid ?? '').endsWith('@g.us');
}

export function isSelectableTestTargetJid(jid) {
  return isUserJid(jid) || isGroupJid(jid);
}

export function normalizeManualTargetJid(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return '';
  const atIndex = value.lastIndexOf('@');
  if (atIndex <= 0 || atIndex === value.length - 1) return '';
  const local = value.slice(0, atIndex).trim();
  const domain = value.slice(atIndex + 1).trim().toLowerCase();
  if (!local) return '';
  if (domain !== 's.whatsapp.net' && domain !== 'g.us') return '';
  return `${local}@${domain}`;
}

export function getAllowedTestJids(currentConfig) {
  const testJids = Array.isArray(currentConfig.testJids) ? currentConfig.testJids : [];
  const set = toJidSet(testJids);
  const legacy = toJidString(currentConfig.testJid);
  if (legacy) set.add(legacy);
  return set;
}

export function getGroupWhitelistJids(currentConfig) {
  const list = Array.isArray(currentConfig.groupWhitelistJids) ? currentConfig.groupWhitelistJids : [];
  return toJidSet(list);
}

function formatNameOrFallback(primary, fallback) {
  const p = String(primary ?? '').trim();
  if (p) return p;
  return String(fallback ?? '').trim() || 'Sem nome';
}

export function mergeContactCacheEntry(contactCache, input) {
  if (!input || typeof input !== 'object') return;

  const jid = toJidString(input.jid) || toJidString(input.id);
  if (!jid || !isUserJid(jid)) return;

  const existing = contactCache.get(jid) ?? { jid, name: jid };
  const nextName = formatNameOrFallback(
    input.name ??
    input.notify ??
    input.verifiedName ??
    input.pushName ??
    input.pushname,
    existing.name ?? jid
  );

  contactCache.set(jid, { jid, name: nextName });
}

export function mergeContactList(contactCache, list) {
  if (!Array.isArray(list)) return;
  for (const item of list) {
    mergeContactCacheEntry(contactCache, item);
  }
}

export function mergeChatsIntoContactCache(contactCache, chats) {
  if (!Array.isArray(chats)) return;
  for (const chat of chats) {
    const jid = toJidString(chat?.id) || toJidString(chat?.jid);
    if (!jid || !jid.endsWith('@s.whatsapp.net')) continue;
    mergeContactCacheEntry(contactCache, {
      id: jid,
      name: chat?.name || chat?.notify || chat?.pushName || jid,
    });
  }
}

export async function waitForContactCacheWarmup(contactCache, timeoutMs = 7000) {
  const started = Date.now();
  while (contactCache.size === 0 && (Date.now() - started) < timeoutMs) {
    await new Promise(resolve => setTimeout(resolve, 250));
  }
}

export async function fetchSelectableContacts(contactCache) {
  const contacts = Array.from(contactCache.values())
    .filter(item => isUserJid(item.jid))
    .sort((a, b) => a.name.localeCompare(b.name));
  return contacts;
}

export async function fetchSelectableGroups(sock) {
  const raw = await sock.groupFetchAllParticipating();
  const groups = Object.entries(raw ?? {})
    .map(([jid, group]) => ({
      jid: String(jid ?? '').trim(),
      name: formatNameOrFallback(group?.subject, jid),
      participants: Array.isArray(group?.participants) ? group.participants.length : 0,
    }))
    .filter(group => isGroupJid(group.jid))
    .sort((a, b) => a.name.localeCompare(b.name));

  return groups;
}

function extractKnownJidsFromConversationEvent(event) {
  const result = new Set();
  const candidates = [
    toJidString(event?.jid),
    toJidString(event?.metadata?.actorJid),
    toJidString(event?.metadata?.chatJid),
  ];
  for (const candidate of candidates) {
    if (isSelectableTestTargetJid(candidate)) {
      result.add(candidate);
    }
  }
  return Array.from(result);
}

export function fetchSavedTestTargetJidsFromDb(contactCache, limit = 2000) {
  const events = listConversationEvents(limit);
  const map = new Map();
  for (const event of events) {
    const knownJids = extractKnownJidsFromConversationEvent(event);
    for (const jid of knownJids) {
      const knownName = contactCache.get(jid)?.name || jid;
      map.set(jid, knownName);
    }
  }
  return Array.from(map.entries())
    .map(([jid, name]) => ({ jid, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function extractSelectableJidsFromMessage(msg) {
  const candidates = [
    toJidString(msg?.key?.remoteJid),
    toJidString(msg?.key?.senderPn),
    toJidString(msg?.key?.participant),
    toJidString(msg?.key?.participantPn),
  ];
  const result = new Set();
  for (const candidate of candidates) {
    if (isSelectableTestTargetJid(candidate)) {
      result.add(candidate);
    }
  }
  return Array.from(result);
}

export function subscribeToRealtimeJidDiscovery({ sock, contactCache, onDiscoveredJid }) {
  if (!sock?.ev || typeof onDiscoveredJid !== 'function') return () => {};
  const unsubscribeFns = [];

  const listen = (eventName, handler) => {
    if (typeof sock.ev.on !== 'function') return;
    sock.ev.on(eventName, handler);
    unsubscribeFns.push(() => {
      if (typeof sock.ev.off === 'function') {
        sock.ev.off(eventName, handler);
        return;
      }
      if (typeof sock.ev.removeListener === 'function') {
        sock.ev.removeListener(eventName, handler);
      }
    });
  };

  const pushJid = jid => {
    const normalized = toJidString(jid);
    if (!isSelectableTestTargetJid(normalized)) return;
    onDiscoveredJid(normalized);
  };

  listen('messages.upsert', ({ messages }) => {
    if (!Array.isArray(messages)) return;
    for (const msg of messages) {
      const discovered = extractSelectableJidsFromMessage(msg);
      for (const jid of discovered) {
        if (isUserJid(jid)) {
          mergeContactCacheEntry(contactCache, {
            id: jid,
            notify: msg?.pushName,
            verifiedName: msg?.verifiedBizName,
          });
        }
        pushJid(jid);
      }
    }
  });

  listen('contacts.upsert', contacts => {
    if (!Array.isArray(contacts)) return;
    mergeContactList(contactCache, contacts);
    for (const contact of contacts) {
      pushJid(toJidString(contact?.id) || toJidString(contact?.jid));
    }
  });

  listen('contacts.update', contacts => {
    if (!Array.isArray(contacts)) return;
    mergeContactList(contactCache, contacts);
    for (const contact of contacts) {
      pushJid(toJidString(contact?.id) || toJidString(contact?.jid));
    }
  });

  listen('chats.upsert', chats => {
    if (!Array.isArray(chats)) return;
    mergeChatsIntoContactCache(contactCache, chats);
    for (const chat of chats) {
      pushJid(toJidString(chat?.id) || toJidString(chat?.jid));
    }
  });

  listen('chats.update', chats => {
    if (!Array.isArray(chats)) return;
    mergeChatsIntoContactCache(contactCache, chats);
    for (const chat of chats) {
      pushJid(toJidString(chat?.id) || toJidString(chat?.jid));
    }
  });

  const removeConversationListener = onConversationEvent(event => {
    const discovered = extractKnownJidsFromConversationEvent(event);
    for (const jid of discovered) {
      pushJid(jid);
    }
  });
  unsubscribeFns.push(removeConversationListener);

  return () => {
    while (unsubscribeFns.length > 0) {
      const fn = unsubscribeFns.pop();
      try {
        fn?.();
      } catch {
        // ignore cleanup errors
      }
    }
  };
}
