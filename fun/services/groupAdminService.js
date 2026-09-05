/**
 * fun/services/groupAdminService.js
 *
 * Encapsula verificações de permissões e operações administrativas em grupos do WhatsApp
 * utilizando as APIs nativas do Baileys (sock).
 */

import { isGroupAdmin } from '../utils/groupMembership.js';
export { checkAdminInMeta };

function localPart(jid = '') {
  const s = String(jid || '').trim();
  const at = s.indexOf('@');
  return at > 0 ? s.slice(0, at) : s;
}

/**
 * Obtém o JID do bot a partir do socket do Baileys.
 * @param {object} sock
 * @returns {string}
 */
export function getBotJid(sock) {
  const raw = String(sock?.user?.id || sock?.authState?.creds?.me?.id || '').trim();
  if (!raw) return '';
  const at = raw.indexOf('@');
  const userPart = (at > 0 ? raw.slice(0, at) : raw).split(':')[0];
  const domain = at > 0 ? raw.slice(at) : '@s.whatsapp.net';
  return `${userPart}${domain.includes('lid') ? '@lid' : '@s.whatsapp.net'}`;
}

/**
 * Valida se a mensagem veio de um grupo, se o executor é admin e se o bot é admin.
 * @param {object} params
 * @param {object} params.sock
 * @param {string} params.chatJid
 * @param {string} params.userJid
 * @param {boolean} params.isGroup
 * @returns {Promise<{ ok: boolean, reason?: string, message?: string, botJid?: string }>}
 */
export async function validateGroupAdminPermissions({ sock, chatJid, userJid, isGroup }) {
  if (!isGroup || !String(chatJid || '').endsWith('@g.us')) {
    return {
      ok: false,
      reason: 'not-group',
      message: '❌ Este comando só pode ser utilizado em *grupos*.',
    };
  }

  if (!sock) {
    return {
      ok: false,
      reason: 'no-socket',
      message: '⚠️ Conexão do bot indisponível para gerenciar o grupo no momento.',
    };
  }

  const botJid = getBotJid(sock);

  let meta = null;
  try {
    if (typeof sock.groupMetadata === 'function') {
      meta = await sock.groupMetadata(chatJid);
    }
  } catch {
    meta = null;
  }

  const userIsAdmin = checkAdminInMeta(meta, userJid);
  if (!userIsAdmin) {
    return {
      ok: false,
      reason: 'user-not-admin',
      message: '❌ Apenas *administradores do grupo* podem usar este comando.',
    };
  }

  if (botJid) {
    const botIsAdmin = checkAdminInMeta(meta, botJid);
    if (!botIsAdmin) {
      return {
        ok: false,
        reason: 'bot-not-admin',
        message: '⚠️ Preciso ser *administrador do grupo* para executar esta ação.',
        botJid,
      };
    }
  }

  return { ok: true, botJid, meta };
}

function checkAdminInMeta(meta, userJid) {
  if (!meta || !userJid) return false;
  const u = String(userJid || '').trim();
  const ul = localPart(u);
  const parts = meta.participants || [];
  for (const p of parts) {
    const ids = [
      p?.id,
      p?.jid,
      p?.phoneNumber,
      p?.participantPn,
      p?.participant_pn,
    ].filter(Boolean).map(String);
    const match = ids.some((id) => id === u || localPart(id) === ul);
    if (!match) continue;
    const admin = String(p?.admin || p?.isAdmin || '').toLowerCase();
    if (admin === 'admin' || admin === 'superadmin' || p?.admin === true) {
      return true;
    }
  }
  return false;
}

/**
 * Resolve o JID alvo para operações de membro (ban, kick, promote, demote, add).
 * Ordem de precedência:
 * 1. Menções diretas (@usuario)
 * 2. Mensagem citada (quoted participant)
 * 3. Número de telefone passado nos argumentos
 *
 * @param {object} params
 * @param {string[]} [params.args]
 * @param {string[]} [params.mentionedJids]
 * @param {string} [params.quotedParticipant]
 * @returns {string}
 */
export function resolveTargetParticipantJid({ args = [], mentionedJids = [], quotedParticipant = '' }) {
  if (Array.isArray(mentionedJids) && mentionedJids.length > 0) {
    const direct = String(mentionedJids[0] || '').trim();
    if (direct) return direct;
  }

  if (quotedParticipant) {
    const quoted = String(quotedParticipant || '').trim();
    if (quoted) return quoted;
  }

  if (Array.isArray(args) && args.length > 0) {
    const combinedClean = args.join('').replace(/[@+\s().-]/g, '').trim();
    if (/^\d{8,20}$/.test(combinedClean)) {
      return `${combinedClean}@s.whatsapp.net`;
    }

    for (const arg of args) {
      const clean = String(arg || '').replace(/[@+\s().-]/g, '').trim();
      if (/^\d{8,20}$/.test(clean)) {
        return `${clean}@s.whatsapp.net`;
      }
      if (clean.includes('@')) {
        return clean;
      }
    }
  }

  return '';
}

/**
 * Gerencia participantes do grupo (add, remove, promote, demote).
 * @param {object} params
 * @param {object} params.sock
 * @param {string} params.chatJid
 * @param {string[]} params.participants
 * @param {'add' | 'remove' | 'promote' | 'demote'} params.action
 */
export async function updateGroupParticipants({ sock, chatJid, participants, action }) {
  if (!sock || typeof sock.groupParticipantsUpdate !== 'function') {
    throw new Error('groupParticipantsUpdate indisponível no socket');
  }
  return sock.groupParticipantsUpdate(chatJid, participants, action);
}

/**
 * Altera configurações do grupo (announcement, not_announcement, locked, unlocked).
 * @param {object} params
 * @param {object} params.sock
 * @param {string} params.chatJid
 * @param {'announcement' | 'not_announcement' | 'locked' | 'unlocked'} params.setting
 */
export async function updateGroupSetting({ sock, chatJid, setting }) {
  if (!sock || typeof sock.groupSettingUpdate !== 'function') {
    throw new Error('groupSettingUpdate indisponível no socket');
  }
  return sock.groupSettingUpdate(chatJid, setting);
}
