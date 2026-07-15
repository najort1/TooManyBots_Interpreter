/**
 * Valida se um user JID é membro de grupos whitelist (via Baileys groupMetadata).
 * Cache em memória com TTL pra não martelar a API a cada comando.
 */

function localPart(jid = '') {
  const s = String(jid || '').trim();
  const at = s.indexOf('@');
  return at > 0 ? s.slice(0, at) : s;
}

/**
 * @param {Set<string>} memberSet
 * @param {string} userJid
 */
export function participantMatches(memberSet, userJid) {
  if (!memberSet || !userJid) return false;
  const u = String(userJid).trim();
  if (memberSet.has(u)) return true;
  const local = localPart(u);
  if (!local) return false;
  if (memberSet.has(local)) return true;
  if (memberSet.has(`${local}@s.whatsapp.net`)) return true;
  if (memberSet.has(`${local}@lid`)) return true;
  for (const p of memberSet) {
    if (localPart(p) === local) return true;
  }
  return false;
}

function collectParticipantIds(participants = []) {
  const set = new Set();
  for (const p of participants) {
    if (!p) continue;
    if (typeof p === 'string') {
      set.add(p.trim());
      continue;
    }
    for (const key of [
      'id',
      'jid',
      'phoneNumber',
      'participant',
      'participantPn',
      'participant_pn',
      'senderPn',
    ]) {
      const v = p[key];
      if (v) set.add(String(v).trim());
    }
  }
  return set;
}

/**
 * @param {object} [opts]
 * @param {number} [opts.ttlMs]
 */
export function createGroupMembershipService({ ttlMs = 5 * 60_000 } = {}) {
  /** @type {Map<string, { set: Set<string>, name: string, at: number }>} */
  const cache = new Map();

  function getTtl(funConfig) {
    const n = Number(funConfig?.dmMembershipCacheTtlMs);
    return Number.isFinite(n) && n >= 0 ? n : ttlMs;
  }

  async function fetchGroup(sock, groupJid) {
    if (!sock || typeof sock.groupMetadata !== 'function') {
      throw new Error('groupMetadata-unavailable');
    }
    const meta = await sock.groupMetadata(String(groupJid));
    return {
      set: collectParticipantIds(meta?.participants || []),
      name: String(meta?.subject || meta?.name || groupJid).trim() || groupJid,
    };
  }

  async function getGroupMembers(sock, groupJid, funConfig = {}) {
    const g = String(groupJid || '').trim();
    const ttl = getTtl(funConfig);
    const hit = cache.get(g);
    if (hit && Date.now() - hit.at < ttl) {
      return { set: hit.set, name: hit.name, cached: true };
    }
    const data = await fetchGroup(sock, g);
    cache.set(g, { ...data, at: Date.now() });
    return { ...data, cached: false };
  }

  /**
   * Lista grupos da whitelist em que o user é membro.
   * @returns {Promise<Array<{ jid: string, name: string }>>}
   */
  async function listUserMemberships({
    sock,
    userJid,
    whitelistJids = [],
    funConfig = {},
  }) {
    const list = Array.isArray(whitelistJids) ? whitelistJids : [...(whitelistJids || [])];
    const out = [];
    for (const g of list) {
      const jid = String(g || '').trim();
      if (!jid.endsWith('@g.us')) continue;
      try {
        const { set, name } = await getGroupMembers(sock, jid, funConfig);
        if (participantMatches(set, userJid)) {
          out.push({ jid, name });
        }
      } catch {
        // grupo inacessível (bot saiu, etc.)
      }
    }
    return out;
  }

  function invalidate(groupJid) {
    if (groupJid) cache.delete(String(groupJid));
    else cache.clear();
  }

  /**
   * Resolve escopo de DM: preferred se ainda membro; senão único; senão precisa escolher.
   */
  async function resolveDmScope({
    sock,
    userJid,
    funConfig = {},
    preferredScopeKey = '',
    lastGroupJid = '',
  }) {
    const whitelist = Array.isArray(funConfig.groupWhitelistJids)
      ? funConfig.groupWhitelistJids
      : [];

    if (funConfig.requireGroupWhitelist !== false && whitelist.length === 0) {
      return { ok: false, reason: 'no-whitelist', groups: [] };
    }

    // sem whitelist obrigatória: DM não tem escopo de grupo seguro
    if (funConfig.requireGroupWhitelist === false && whitelist.length === 0) {
      return { ok: false, reason: 'dm-needs-whitelist', groups: [] };
    }

    if (!sock) {
      return { ok: false, reason: 'no-socket', groups: [] };
    }

    const groups = await listUserMemberships({
      sock,
      userJid,
      whitelistJids: whitelist,
      funConfig,
    });

    if (groups.length === 0) {
      return { ok: false, reason: 'not-member', groups: [] };
    }

    const preferred = String(preferredScopeKey || '').trim();
    if (preferred && groups.some(g => g.jid === preferred)) {
      return {
        ok: true,
        scopeKey: preferred,
        groups,
        source: 'preferred',
      };
    }

    const last = String(lastGroupJid || '').trim();
    if (last && groups.some(g => g.jid === last)) {
      return {
        ok: true,
        scopeKey: last,
        groups,
        source: 'last-group',
      };
    }

    if (groups.length === 1) {
      return {
        ok: true,
        scopeKey: groups[0].jid,
        groups,
        source: 'single',
      };
    }

    return {
      ok: false,
      reason: 'need-group-pick',
      groups,
    };
  }

  return {
    getGroupMembers,
    listUserMemberships,
    resolveDmScope,
    participantMatches,
    invalidate,
  };
}
