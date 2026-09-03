/**
 * Identidade canônica de usuário no Fun.
 * Baileys v7 entrega LID como identidade primária. O PN é mantido somente
 * como alias transitório para migrar dados criados antes do v7.
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
 * Identidade de usuário válida para o domínio: LID primário ou PN legado.
 */
export function isCanonicalUserJid(jid = '') {
  return isLikelyRealUserJid(jid);
}

function toLidJid(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (isLidJid(raw)) return raw;
  return looksLikeOpaqueLid(raw) ? `${jidLocalPart(raw)}@lid` : '';
}

function toPnJid(value = '') {
  const raw = String(value || '').trim();
  return raw.endsWith('@s.whatsapp.net') && !looksLikeOpaqueLid(raw) && isLikelyRealUserJid(raw)
    ? raw
    : '';
}

/**
 * Resolve a identidade utilizável de um Contact do Baileys. Em v7 `id`/`lid`
 * são preferidos; o `phoneNumber` serve para associar e migrar o registro PN.
 */
export function resolveContactIdentity(contact = {}, identityMap = null) {
  const item = contact && typeof contact === 'object' ? contact : {};
  const phoneNumber = String(item.phoneNumber || item.phone_number || '').trim();
  const phoneJid = phoneNumber ? (phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@s.whatsapp.net`) : '';
  const lidJid = [item.lid, item.id, item.jid].map(toLidJid).find(Boolean) || '';
  const pnJid = [phoneJid, item.pn, item.participantPn, item.participant_pn, item.id, item.jid]
    .map(toPnJid)
    .find(Boolean) || '';

  if (lidJid && pnJid) identityMap?.remember?.(lidJid, pnJid);
  const jid = identityMap?.resolve?.(lidJid || pnJid) || lidJid || pnJid;

  const displayName = [item.name, item.notify, item.verifiedName]
    .map((value) => String(value || '').replace(/^~+\s*/, '').trim())
    .find((value) => value && value !== jid && value !== jidLocalPart(jid)) || '';

  return { jid, displayName };
}

/**
 * Mapa mutável de aliases PN/LID para o LID primário.
 */
export function createIdentityMap() {
  /** @type {Map<string, string>} */
  const aliasesToLid = new Map();
  /** @type {Map<string, string>} */
  const lidToPn = new Map();

  function remember(lidOrKey, pnJid) {
    const lid = toLidJid(lidOrKey);
    const pn = toPnJid(pnJid);
    if (!lid || !pn) return false;
    aliasesToLid.set(lid, lid);
    aliasesToLid.set(normalizeIdentityKey(lid), lid);
    aliasesToLid.set(pn, lid);
    aliasesToLid.set(normalizeIdentityKey(pn), lid);
    lidToPn.set(lid, pn);
    return true;
  }

  function resolve(raw) {
    const jid = String(raw || '').trim();
    if (!jid) return '';
    const lid = toLidJid(jid);
    if (lid) return lid;
    if (aliasesToLid.has(jid)) return aliasesToLid.get(jid) || '';
    const local = normalizeIdentityKey(jid);
    if (aliasesToLid.has(local)) return aliasesToLid.get(local) || '';
    return toPnJid(jid);
  }

  function getPn(raw) {
    const lid = resolve(raw);
    return lidToPn.get(lid) || '';
  }

  function learnFromMessageKey(messageKey = {}, actorJid = '') {
    const key = messageKey && typeof messageKey === 'object' ? messageKey : {};
    const lidCandidates = [
      key.participantLid,
      key.participant_lid,
      key.sender_lid,
      key.senderLid,
      key.participant,
      key.senderJid,
      actorJid,
    ];
    const pnCandidates = [
      key.participantAlt,
      key.participant_alt,
      key.remoteJidAlt,
      key.remote_jid_alt,
      key.participantPn,
      key.participant_pn,
      key.senderPn,
      key.sender_pn,
      actorJid,
    ];
    const pn = pnCandidates.map(toPnJid).find(Boolean) || '';
    if (!pn) return;
    for (const candidate of lidCandidates) remember(candidate, pn);
  }

  function learnFromGroupParticipants(participants = []) {
    for (const p of participants) {
      const pn = [p?.phoneNumber, p?.phone_number, p?.pn, p?.jid, p?.id, p?.participantPn, p?.participant_pn]
        .map(toPnJid)
        .find(Boolean) || '';
      if (!pn) continue;
      for (const candidate of [p?.lid, p?.id, p?.jid]) remember(candidate, pn);
    }
  }

  return {
    remember,
    resolve,
    getPn,
    learnFromMessageKey,
    learnFromGroupParticipants,
    /** @internal */
    _map: aliasesToLid,
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
 * Carrega participantes do grupo e alimenta o mapa de aliases LID/PN.
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
 * Lista membros de um grupo com LIDs canônicos. Carrega metadata uma vez e
 * reaproveita o mapa de aliases para não voltar a usar PN nos serviços.
 */
export async function listCanonicalGroupParticipantJids(sock, groupJid, identityMap) {
  const participants = await loadGroupIdentity(sock, groupJid, identityMap);
  const ids = [];
  for (const participant of participants) {
    const candidates = [participant?.lid, participant?.id, participant?.jid];
    for (const raw of candidates) {
      const value = String(raw || '').trim();
      const resolved = identityMap?.resolve?.(value) || value;
      if (!isCanonicalUserJid(resolved)) continue;
      ids.push(resolved);
      break;
    }
  }
  return [...new Set(ids)];
}

/**
 * Resolve um raw jid para LID canônico quando o mapeamento já é conhecido.
 * Um PN legado sem mapeamento continua sendo aceito para não perder dados.
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

  // O mapa de aliases SEMPRE primeiro (inclusive quando LID vem como @s.whatsapp.net).
  if (identityMap) {
    const mapped = identityMap.resolve(input);
    if (isLidJid(mapped)) return mapped;
  }

  if (isLidJid(input)) return input;

  // Um PN legado só é devolvido quando não há metadata disponível para
  // associá-lo ao LID atual do membro. Isso impede que comandos por nome ou
  // número recriem dados PN depois da migração para Baileys v7.
  if (isCanonicalUserJid(input) && (!sock || !groupJid || !identityMap)) return input;

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
    // Match da parte local contra participantes e promove o LID como resultado.
    const local = normalizeIdentityKey(input);
    try {
      const meta = await sock.groupMetadata(groupJid);
      for (const p of meta?.participants || []) {
        const lid = [p?.lid, p?.id, p?.jid].map(toLidJid).find(Boolean) || '';
        const pn = [p?.phoneNumber, p?.phone_number, p?.pn, p?.jid, p?.id].map(toPnJid).find(Boolean) || '';
        if (lid && pn) identityMap.remember(lid, pn);
        const primary = identityMap.resolve(lid || pn);
        if (!primary) continue;
        const lidLocal = normalizeIdentityKey(p?.lid || '');
        const idLocal = normalizeIdentityKey(p?.id || '');
        if (local && (local === lidLocal || local === idLocal || local === normalizeIdentityKey(pn) || local === normalizeIdentityKey(primary))) {
          return primary;
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
    if (byName) {
      const jid = await resolveCanonicalUserJid(byName, {
        identityMap,
        sock,
        groupJid,
        contacts,
      });
      if (jid && jid !== exclude) return { jid, via: 'name' };
    }

    // tenta nomes dos participantes do grupo
    if (sock && groupJid) {
      const participants = await loadGroupIdentity(sock, groupJid, identityMap);
      const groupContacts = participants
        .map(p => {
          const raw = [p?.lid, p?.id, p?.jid].map((value) => String(value || '').trim()).find(Boolean) || '';
          const jid = identityMap?.resolve?.(raw) || raw;
          const name = p?.name || p?.notify || p?.verifiedName || '';
          return jid ? { jid, name } : null;
        })
        .filter(Boolean);
      // merge com lista de contatos do app (pushName persistido)
      byName = findJidByDisplayName(nameQuery, [...contacts, ...groupContacts]);
      if (byName) {
        const jid = await resolveCanonicalUserJid(byName, {
          identityMap,
          sock,
          groupJid,
          contacts: [...contacts, ...groupContacts],
        });
        if (jid && jid !== exclude) return { jid, via: 'group-name' };
      }
    }
  }

  return { jid: '', via: 'none' };
}
