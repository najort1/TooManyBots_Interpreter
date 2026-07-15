/**
 * Identidade canônica de usuário no Fun.
 * WhatsApp multi-device manda menções como @lid; XP/coins usam @s.whatsapp.net (PN).
 */

import { isUserJid, isLidJid, isLikelyRealUserJid } from '../../runtime/contactUtils.js';

export function jidLocalPart(jid = '') {
  const raw = String(jid || '').trim();
  const at = raw.indexOf('@');
  return at > 0 ? raw.slice(0, at) : raw;
}

export function normalizeIdentityKey(jid = '') {
  return jidLocalPart(jid);
}

/**
 * Heurística: LID opaco costuma ser longo e sem DDI comum (ex.: 55…).
 * Ex. bug reportado: 281350775005409@s.whatsapp.net (menção LID, não PN).
 */
export function looksLikeOpaqueLid(jid = '') {
  const local = jidLocalPart(jid);
  if (!/^\d{10,20}$/.test(local)) return false;
  // E.164 com DDI BR e similares raramente passa de 13–14 dígitos úteis no WA
  if (local.length >= 14 && !/^(55|1|44|351|54|56|57|58|51|52|34|33|49|39)/.test(local)) {
    return true;
  }
  // @lid explícito
  if (String(jid).endsWith('@lid')) return true;
  return false;
}

/**
 * PN válido para economia/rank (não LID disfarçado).
 */
export function isCanonicalUserJid(jid = '') {
  if (!isLikelyRealUserJid(jid)) return false;
  if (looksLikeOpaqueLid(jid)) return false;
  return true;
}

/**
 * Mapa mutável lidLocal|fullLid → pnJid
 */
export function createIdentityMap() {
  /** @type {Map<string, string>} */
  const lidToPn = new Map();

  function remember(lidOrKey, pnJid) {
    const pn = String(pnJid || '').trim();
    if (!isCanonicalUserJid(pn)) return false;
    const key = String(lidOrKey || '').trim();
    if (!key) return false;
    lidToPn.set(key, pn);
    lidToPn.set(normalizeIdentityKey(key), pn);
    if (key.includes('@')) {
      lidToPn.set(normalizeIdentityKey(key), pn);
    } else {
      lidToPn.set(`${key}@lid`, pn);
    }
    return true;
  }

  function resolve(raw) {
    const jid = String(raw || '').trim();
    if (!jid) return '';
    if (isCanonicalUserJid(jid)) return jid;
    if (lidToPn.has(jid)) return lidToPn.get(jid) || '';
    const local = normalizeIdentityKey(jid);
    if (lidToPn.has(local)) return lidToPn.get(local) || '';
    if (isLidJid(jid) && lidToPn.has(jid)) return lidToPn.get(jid) || '';
    return '';
  }

  function learnFromMessageKey(messageKey = {}, actorPn = '') {
    const key = messageKey && typeof messageKey === 'object' ? messageKey : {};
    const pn =
      String(actorPn || '').trim() ||
      String(key.participantPn || key.participant_pn || key.senderPn || key.sender_pn || '').trim();
    if (!isCanonicalUserJid(pn)) return;

    const lidCandidates = [
      key.participantLid,
      key.participant_lid,
      key.sender_lid,
      key.senderLid,
      key.participant,
      key.participantAlt,
    ];
    for (const c of lidCandidates) {
      const j = String(c || '').trim();
      if (!j) continue;
      if (isLidJid(j) || (!j.includes('@') && /^\d{10,20}$/.test(j))) {
        remember(j.endsWith('@lid') ? j : j.includes('@') ? j : `${j}@lid`, pn);
      }
      // LID às vezes vem como número longo @s.whatsapp.net (inválido como PN de verdade para o app)
      if (j.endsWith('@s.whatsapp.net') && !isCanonicalUserJid(j)) {
        remember(j, pn);
        remember(jidLocalPart(j), pn);
      }
    }
  }

  function learnFromGroupParticipants(participants = []) {
    for (const p of participants) {
      const pn = String(p?.jid || '').trim();
      const id = String(p?.id || '').trim();
      const lid = String(p?.lid || '').trim();
      const phoneJid = isCanonicalUserJid(pn)
        ? pn
        : isCanonicalUserJid(id)
          ? id
          : '';
      if (!phoneJid) continue;
      if (lid) remember(lid, phoneJid);
      if (id && (isLidJid(id) || id !== phoneJid)) remember(id, phoneJid);
    }
  }

  return {
    remember,
    resolve,
    learnFromMessageKey,
    learnFromGroupParticipants,
    /** @internal */
    _map: lidToPn,
  };
}

function normalizeName(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Remove valor monético e tokens de jid; sobra possível nome (@Anjo Azul).
 */
export function extractNameQueryFromArgs(args = []) {
  const parts = [];
  let skippedAmount = false;
  for (const arg of args) {
    const raw = String(arg || '').trim();
    if (!raw) continue;
    const token = raw.replace(/^@/, '');
    if (!skippedAmount && /^\d+$/.test(token) && Number(token) < 1_000_000_000) {
      // amount (evita consumir telefone longo como "amount" se for o único token dígitos curto)
      skippedAmount = true;
      continue;
    }
    if (token.includes('@')) continue;
    if (/^\d{8,20}$/.test(token)) continue;
    parts.push(token);
  }
  return parts.join(' ').trim();
}

/**
 * Busca contato por nome (exato > começa com > contém). Ambíguo → ''.
 */
export function findJidByDisplayName(query, contacts = []) {
  const q = normalizeName(query);
  if (!q || q.length < 2) return '';

  const rows = (Array.isArray(contacts) ? contacts : [])
    .map(c => ({
      jid: String(c?.jid || '').trim(),
      name: normalizeName(c?.name || c?.displayName || ''),
    }))
    .filter(c => isCanonicalUserJid(c.jid) && c.name);

  const exact = rows.filter(c => c.name === q);
  if (exact.length === 1) return exact[0].jid;
  if (exact.length > 1) return '';

  const starts = rows.filter(c => c.name.startsWith(q) || q.startsWith(c.name));
  if (starts.length === 1) return starts[0].jid;

  const includes = rows.filter(c => c.name.includes(q) || q.includes(c.name));
  if (includes.length === 1) return includes[0].jid;

  return '';
}

/**
 * Carrega participantes do grupo e alimenta o mapa lid→pn.
 */
export async function loadGroupIdentity(sock, groupJid, identityMap) {
  if (!sock || typeof sock.groupMetadata !== 'function') return [];
  const jid = String(groupJid || '').trim();
  if (!jid.endsWith('@g.us')) return [];
  try {
    const meta = await sock.groupMetadata(jid);
    const participants = Array.isArray(meta?.participants) ? meta.participants : [];
    identityMap?.learnFromGroupParticipants?.(participants);
    return participants;
  } catch {
    return [];
  }
}

/**
 * Resolve um raw jid (pn, lid, ou lid@s.whatsapp.net) para PN canônico.
 */
export async function resolveCanonicalUserJid(raw, {
  identityMap = null,
  sock = null,
  groupJid = '',
  contacts = [],
  nameQuery = '',
} = {}) {
  const input = String(raw || '').trim();
  if (!input) return '';

  // Mapa lid→pn SEMPRE primeiro (inclusive quando LID vem como @s.whatsapp.net)
  if (identityMap) {
    const mapped = identityMap.resolve(input);
    if (isCanonicalUserJid(mapped)) return mapped;
  }

  if (isCanonicalUserJid(input)) return input;

  // nome explícito
  if (nameQuery) {
    const byName = findJidByDisplayName(nameQuery, contacts);
    if (byName) return byName;
  }

  // recarrega grupo e tenta de novo
  if (sock && groupJid && identityMap) {
    await loadGroupIdentity(sock, groupJid, identityMap);
    if (input) {
      const mapped2 = identityMap.resolve(input);
      if (isCanonicalUserJid(mapped2)) return mapped2;
    }
    // match local part against participants.jid/lid
    const local = normalizeIdentityKey(input);
    try {
      const meta = await sock.groupMetadata(groupJid);
      for (const p of meta?.participants || []) {
        const pn = isCanonicalUserJid(p?.jid)
          ? p.jid
          : isCanonicalUserJid(p?.id)
            ? p.id
            : '';
        if (!pn) continue;
        const lidLocal = normalizeIdentityKey(p?.lid || '');
        const idLocal = normalizeIdentityKey(p?.id || '');
        if (local && (local === lidLocal || local === idLocal || local === normalizeIdentityKey(pn))) {
          identityMap.remember(input, pn);
          return pn;
        }
      }
    } catch {
      // ignore
    }
  }

  // última tentativa: nome
  if (!nameQuery && contacts.length) {
    // no-op
  }

  return '';
}

/**
 * Resolve alvo de pay/marry/ship a partir de menções, reply, número ou nome.
 */
export async function resolveUserTarget({
  args = [],
  mentionedJids = [],
  quotedParticipant = '',
  excludeJid = '',
  identityMap = null,
  sock = null,
  groupJid = '',
  contacts = [],
} = {}) {
  const exclude = String(excludeJid || '').trim();
  const nameQuery = extractNameQueryFromArgs(args);

  const candidates = [];
  for (const m of mentionedJids) {
    const j = String(m || '').trim();
    if (j) candidates.push(j);
  }
  if (quotedParticipant) candidates.push(String(quotedParticipant).trim());

  for (const arg of args) {
    const token = String(arg || '').trim().replace(/^@/, '');
    if (!token) continue;
    if (token.includes('@')) candidates.push(token);
    else if (/^\d{8,20}$/.test(token)) candidates.push(`${token}@s.whatsapp.net`);
  }

  // 1) candidatos jid
  for (const raw of candidates) {
    const resolved = await resolveCanonicalUserJid(raw, {
      identityMap,
      sock,
      groupJid,
      contacts,
    });
    if (resolved && resolved !== exclude) return { jid: resolved, via: 'jid' };
  }

  // 2) nome (@Anjo Azul sem menção real, ou com menção lid falha)
  if (nameQuery) {
    // tenta contatos conhecidos
    let byName = findJidByDisplayName(nameQuery, contacts);
    if (byName && byName !== exclude) return { jid: byName, via: 'name' };

    // tenta nomes dos participantes do grupo
    if (sock && groupJid) {
      const participants = await loadGroupIdentity(sock, groupJid, identityMap);
      const groupContacts = participants
        .map(p => {
          const jid = isCanonicalUserJid(p?.jid)
            ? p.jid
            : isCanonicalUserJid(p?.id)
              ? p.id
              : '';
          const name = p?.name || p?.notify || p?.verifiedName || '';
          return jid ? { jid, name } : null;
        })
        .filter(Boolean);
      // merge com lista de contatos do app (pushName persistido)
      byName = findJidByDisplayName(nameQuery, [...contacts, ...groupContacts]);
      if (byName && byName !== exclude) return { jid: byName, via: 'group-name' };
    }
  }

  return { jid: '', via: 'none' };
}
