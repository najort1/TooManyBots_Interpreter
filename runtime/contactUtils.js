import { listConversationEvents, onConversationEvent } from '../db/index.js';
import { delay } from '../utils/async.js';

export function getMessageDebugInfo(msg, type) {
  const key = msg.key ?? {};
  const remoteJid = key.remoteJid ?? key.remote_jid ?? '';
  const senderPn = key.senderPn ?? key.sender_pn ?? '';
  const participant = key.participant ?? '';
  const participantPn = key.participantPn ?? key.participant_pn ?? '';
  const notify = key.notify ?? key.Notify ?? msg.notify ?? msg.Notify ?? msg.pushName ?? msg.pushname ?? '';
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
    participantPn,
    notify,
    fromMe,
    hasMessage,
    messageKeys,
    dropReason,
  };
}

export function normalizeInteractionScope(flow) {
  const explicitScope = String(flow?.runtimeConfig?.interactionScope ?? '').trim().toLowerCase();
  const conversationMode = String(flow?.runtimeConfig?.conversationMode ?? 'conversation').trim().toLowerCase();
  if (explicitScope) {
    if (conversationMode === 'conversation' && (explicitScope === 'all' || explicitScope === 'any')) {
      // Backward-compatible safety: old flows often persisted interactionScope="all".
      // For conversation bots, treat it as direct users only.
      return 'all-users';
    }
    return explicitScope;
  }

  // Default safety: conversation bots should not run in groups unless scope explicitly mentions groups.
  if (conversationMode === 'conversation') return 'all-users';
  return 'all';
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
    if (typeof value.remote_jid === 'string') return value.remote_jid.trim();
    if (typeof value.jid === 'string') return value.jid.trim();
    if (typeof value.id === 'string') return value.id.trim();
    if (typeof value.senderPn === 'string') return value.senderPn.trim();
    if (typeof value.sender_pn === 'string') return value.sender_pn.trim();
    if (typeof value.participantPn === 'string') return value.participantPn.trim();
    if (typeof value.participant_pn === 'string') return value.participant_pn.trim();
    if (typeof value.participant === 'string') return value.participant.trim();
  }
  return '';
}

function extractPersonJidFromMessageKey(messageKey = {}) {
  const candidates = [
    messageKey.participantPn,
    messageKey.participant_pn,
    messageKey.senderPn,
    messageKey.sender_pn,
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

export function isLidJid(jid) {
  return String(jid ?? '').endsWith('@lid');
}

export function isGroupJid(jid) {
  return String(jid ?? '').endsWith('@g.us');
}

export function isSelectableTestTargetJid(jid) {
  return isUserJid(jid) || isGroupJid(jid);
}

function extractJidLocalPart(jid) {
  const normalized = toJidString(jid);
  const atIndex = normalized.lastIndexOf('@');
  if (atIndex <= 0) return '';
  return normalized.slice(0, atIndex);
}

export function isLikelyRealUserJid(jid) {
  if (!isUserJid(jid)) return false;
  const local = extractJidLocalPart(jid);
  return /^\d{8,20}$/.test(local);
}

export function isLikelyRealGroupJid(jid) {
  if (!isGroupJid(jid)) return false;
  const local = extractJidLocalPart(jid);
  return /^\d{8,24}(?:-\d{1,24})?$/.test(local);
}

export function isLikelyRealSelectableJid(jid) {
  return isLikelyRealUserJid(jid) || isLikelyRealGroupJid(jid);
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
  if (p) {
    return p.replace(/^~+\s*/, '').trim() || p;
  }
  return String(fallback ?? '').trim() || 'Sem nome';
}

function normalizeCandidateName(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const cleaned = raw.replace(/^~+\s*/, '').trim();
  return cleaned || raw;
}

function isMeaningfulDisplayName(name, jid = '') {
  const normalizedName = normalizeCandidateName(name);
  if (!normalizedName) return false;
  const normalizedJid = toJidString(jid);
  if (normalizedJid && normalizedName === normalizedJid) return false;
  const jidLocalPart = extractJidLocalPart(normalizedJid);
  if (jidLocalPart) {
    if (normalizedName === jidLocalPart) return false;
    if (normalizedName === `+${jidLocalPart}`) return false;
  }
  return true;
}

function resolveBestDisplayName({ candidate = '', fallback = '', jid = '' } = {}) {
  if (isMeaningfulDisplayName(candidate, jid)) {
    return formatNameOrFallback(candidate, jid);
  }
  if (isMeaningfulDisplayName(fallback, jid)) {
    return formatNameOrFallback(fallback, jid);
  }
  return formatNameOrFallback('', jid);
}

export function mergeContactCacheEntry(contactCache, input) {
  if (!input || typeof input !== 'object') return;

  const messageKey = input?.key && typeof input.key === 'object' ? input.key : {};
  const directJidCandidates = [
    toJidString(input),
    toJidString(input.jid),
    toJidString(input.id),
    toJidString(input.remoteJid),
    toJidString(input.remote_jid),
    toJidString(input.participant),
    toJidString(input.participantPn),
    toJidString(input.participant_pn),
    toJidString(input.senderPn),
    toJidString(input.sender_pn),
    toJidString(messageKey.participant),
    toJidString(messageKey.participantPn),
    toJidString(messageKey.participant_pn),
    toJidString(messageKey.senderPn),
    toJidString(messageKey.sender_pn),
    toJidString(messageKey.remoteJid),
    toJidString(messageKey.remote_jid),
  ].filter(Boolean);

  const personJids = directJidCandidates.filter(jid => isUserJid(jid) || isLidJid(jid));
  if (personJids.length === 0) return;

  const explicitName = normalizeCandidateName(
    input.name ??
    input.notify ??
    input.Notify ??
    input.verifiedBizName ??
    input.verifiedName ??
    input.pushName ??
    input.pushname ??
    messageKey.notify ??
    messageKey.Notify ??
    messageKey.pushName ??
    messageKey.pushname ??
    messageKey.verifiedBizName
  );

  for (const jid of personJids) {
    const existing = contactCache.get(jid) ?? { jid, name: jid };
    const nextName = resolveBestDisplayName({
      candidate: explicitName,
      fallback: existing.name ?? jid,
      jid,
    });
    contactCache.set(jid, { jid, name: nextName });
  }
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
    if (!jid) continue;

    if (isUserJid(jid)) {
      mergeContactCacheEntry(contactCache, {
        id: jid,
        name: chat?.name || chat?.notify || chat?.pushName || jid,
      });
      continue;
    }

    if (isGroupJid(jid)) {
      const existingName = contactCache.get(jid)?.name || '';
      const groupName = resolveBestDisplayName({
        candidate: chat?.name || chat?.subject || chat?.notify || chat?.pushName || '',
        fallback: existingName,
        jid,
      });
      contactCache.set(jid, { jid, name: groupName });
    }
  }
}

export async function waitForContactCacheWarmup(contactCache, timeoutMs = 7000) {
  const started = Date.now();
  while (contactCache.size === 0 && (Date.now() - started) < timeoutMs) {
    await delay(250);
  }
}

export async function fetchSelectableContacts(contactCache) {
  const contacts = Array.from(contactCache.values())
    .filter(item => isUserJid(item.jid))
    .sort((a, b) => a.name.localeCompare(b.name));
  return contacts;
}

export async function fetchSelectableGroups(sock, contactCache = null) {
  const raw = await sock.groupFetchAllParticipating();
  const groups = Object.entries(raw ?? {})
    .map(([jid, group]) => {
      const normalizedJid = String(jid ?? '').trim();
      const cachedName = contactCache?.get?.(normalizedJid)?.name || '';
      return {
        jid: normalizedJid,
        name: resolveBestDisplayName({
          candidate: group?.subject || group?.name || '',
          fallback: cachedName,
          jid: normalizedJid,
        }),
        participants: Array.isArray(group?.participants) ? group.participants.length : 0,
      };
    })
    .filter(group => isGroupJid(group.jid))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (contactCache && typeof contactCache.set === 'function') {
    for (const group of groups) {
      const groupJid = String(group?.jid || '').trim();
      if (!groupJid) continue;
      const groupName = formatNameOrFallback(group?.name, groupJid);
      contactCache.set(groupJid, { jid: groupJid, name: groupName });
    }
  }

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
      if (!isLikelyRealSelectableJid(jid)) continue;
      const knownName = contactCache.get(jid)?.name || jid;
      map.set(jid, knownName);
    }
  }
  return Array.from(map.entries())
    .map(([jid, name]) => ({ jid, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function extractSelectableJidsFromMessage(msg) {
  const messageKey = msg?.key && typeof msg.key === 'object' ? msg.key : {};
  const candidates = [
    toJidString(messageKey.remoteJid),
    toJidString(messageKey.remote_jid),
    toJidString(messageKey.senderPn),
    toJidString(messageKey.sender_pn),
    toJidString(messageKey.participant),
    toJidString(messageKey.participantPn),
    toJidString(messageKey.participant_pn),
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
      const messageKey = msg?.key && typeof msg.key === 'object' ? msg.key : {};
      mergeContactCacheEntry(contactCache, {
        ...msg,
        key: messageKey,
        notify:
          messageKey.notify ??
          messageKey.Notify ??
          msg?.notify ??
          msg?.Notify ??
          msg?.pushName ??
          msg?.pushname ??
          '',
        verifiedName:
          messageKey.verifiedBizName ??
          messageKey.verifiedName ??
          msg?.verifiedBizName ??
          msg?.verifiedName ??
          '',
      });
      const discovered = extractSelectableJidsFromMessage(msg);
      for (const jid of discovered) {
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
