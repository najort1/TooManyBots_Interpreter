export function normalizeSessionScope(scope = null) {
  if (typeof scope === 'string') {
    return {
      flowPath: String(scope || '').trim(),
      botType: null,
    };
  }

  if (scope && typeof scope === 'object') {
    const flowPath = String(scope.flowPath ?? '').trim();
    const botTypeRaw = String(scope.botType ?? '').trim().toLowerCase();
    const botType = botTypeRaw === 'command' ? 'command' : (botTypeRaw ? 'conversation' : null);
    return { flowPath, botType };
  }

  return { flowPath: '', botType: null };
}

export function toJsonPath(key) {
  const safe = String(key ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `$."${safe}"`;
}

export function mapSessionRow(row) {
  return {
    jid: row.jid,
    flowPath: row.flow_path,
    botType: row.bot_type,
    blockIndex: row.block_index,
    variables: JSON.parse(row.variables),
    status: row.status,
    waitingFor: row.waiting_for,
    updatedAt: Number(row.updated_at) || 0,
  };
}

export function safeParseJson(text, fallback = {}) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

export function normalizeMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') return {};
  return metadata;
}

export function mapConversationEventRow(row) {
  return {
    id: row.id,
    occurredAt: row.occurred_at,
    eventType: row.event_type,
    direction: row.direction,
    jid: row.jid,
    flowPath: row.flow_path,
    messageText: row.message_text,
    metadata: safeParseJson(row.metadata, {}),
  };
}

export function mapBroadcastContactRow(row) {
  const jid = String(row?.jid || '').trim();
  return {
    jid,
    name: String(row?.display_name || '').trim(),
    lastInteractionAt: Number(row?.last_interaction_at) || 0,
    recipientType: String(row?.recipient_type || '').trim().toLowerCase() === 'group'
      ? 'group'
      : (isLikelyRealWhatsAppGroupJid(jid) ? 'group' : 'individual'),
  };
}

export function isLikelyRealWhatsAppUserJid(jid = '') {
  const normalized = String(jid ?? '').trim();
  if (!normalized.endsWith('@s.whatsapp.net')) return false;
  const atIndex = normalized.indexOf('@');
  if (atIndex <= 0) return false;
  const localPart = normalized.slice(0, atIndex);
  return /^\d{8,20}$/.test(localPart);
}

export function isLikelyRealWhatsAppGroupJid(jid = '') {
  const normalized = String(jid ?? '').trim();
  if (!normalized.endsWith('@g.us')) return false;
  const atIndex = normalized.indexOf('@');
  if (atIndex <= 0) return false;
  const localPart = normalized.slice(0, atIndex);
  return /^\d{8,24}(?:-\d{1,24})?$/.test(localPart);
}

export function isLikelyRealBroadcastRecipientJid(jid = '') {
  return isLikelyRealWhatsAppUserJid(jid) || isLikelyRealWhatsAppGroupJid(jid);
}

export function getBroadcastRecipientType(jid = '') {
  if (isLikelyRealWhatsAppGroupJid(jid)) return 'group';
  if (isLikelyRealWhatsAppUserJid(jid)) return 'individual';
  return '';
}

function normalizeRecipientType(value = '') {
  return String(value ?? '').trim().toLowerCase() === 'group' ? 'group' : 'individual';
}

export function normalizePersistedDisplayName(value, fallbackJid = '') {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const cleaned = raw.replace(/^~+\s*/, '').trim();
  const resolved = cleaned || raw;
  if (!resolved) return '';
  const normalizedJid = String(fallbackJid ?? '').trim();
  if (normalizedJid && resolved === normalizedJid) return '';
  return resolved.slice(0, 180);
}

export function normalizeRecipientList(recipients = []) {
  if (!Array.isArray(recipients)) return [];
  const seen = new Set();
  const result = [];
  for (const item of recipients) {
    const jid = String(item ?? '').trim();
    if (!jid || seen.has(jid)) continue;
    seen.add(jid);
    result.push(jid);
  }
  return result;
}

export function normalizeBroadcastRecipientList(recipients = []) {
  if (!Array.isArray(recipients)) return [];
  const seen = new Set();
  const result = [];

  for (const item of recipients) {
    const jid = String(typeof item === 'string' ? item : item?.jid ?? '').trim();
    if (!jid || seen.has(jid)) continue;
    if (!isLikelyRealBroadcastRecipientJid(jid)) continue;

    const inferredType = getBroadcastRecipientType(jid);
    const requestedType = normalizeRecipientType(typeof item === 'string' ? '' : item?.recipientType ?? '');
    result.push({
      jid,
      recipientType: inferredType || requestedType,
    });
    seen.add(jid);
  }

  return result;
}
