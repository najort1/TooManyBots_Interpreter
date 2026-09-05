/**
 * fun/commands/handlers/groupAdmin.js
 *
 * Handlers para comandos de administração de grupo:
 * - Membros: /ban, /kick, /promover, /rebaixar, /add
 * - Configurações: /fechar, /abrir, /trancar, /destrancar
 */

import {
  validateGroupAdminPermissions,
  resolveTargetParticipantJid,
  updateGroupParticipants,
  updateGroupSetting,
  checkAdminInMeta,
} from '../../services/groupAdminService.js';
import { isGroupAdmin } from '../../utils/groupMembership.js';

function localPart(jid = '') {
  const s = String(jid || '').trim();
  const at = s.indexOf('@');
  return at > 0 ? s.slice(0, at) : s;
}

function isSameUser(jidA, jidB) {
  if (!jidA || !jidB) return false;
  if (jidA === jidB) return true;
  return localPart(jidA) === localPart(jidB);
}

function formatTargetMention(jid) {
  return `@${localPart(jid)}`;
}

/**
 * /ban ou /kick — Remove um membro do grupo.
 */
export async function handleGroupBanCommand({
  sock,
  chatJid,
  userJid,
  isGroup,
  args = [],
  mentionedJids = [],
  quotedParticipant = '',
  reply,
}) {
  const perm = await validateGroupAdminPermissions({ sock, chatJid, userJid, isGroup });
  if (!perm.ok) {
    await reply(perm.message);
    return { handled: true, success: false, reason: perm.reason };
  }

  const targetJid = resolveTargetParticipantJid({ args, mentionedJids, quotedParticipant });
  if (!targetJid) {
    await reply('⚠️ Mencione o usuário (@alvo), responda a uma mensagem dele ou digite o número para remover.');
    return { handled: true, success: false, reason: 'missing-target' };
  }

  if (perm.botJid && isSameUser(targetJid, perm.botJid)) {
    await reply('😅 Eu não posso remover a mim mesmo do grupo!');
    return { handled: true, success: false, reason: 'cannot-ban-bot' };
  }

  if (isSameUser(targetJid, userJid)) {
    await reply('🤔 Você não pode remover a si mesmo. Use as configurações do WhatsApp para sair do grupo.');
    return { handled: true, success: false, reason: 'cannot-ban-self' };
  }

  try {
    await updateGroupParticipants({
      sock,
      chatJid,
      participants: [targetJid],
      action: 'remove',
    });

    await reply(`🚪 ${formatTargetMention(targetJid)} foi removido do grupo.`);
    return { handled: true, success: true, targetJid };
  } catch (error) {
    const errorMsg = String(error?.message || error);
    await reply(`❌ Erro ao remover membro: ${errorMsg}`);
    return { handled: true, success: false, error: errorMsg };
  }
}

/**
 * /promover — Promove um membro a administrador do grupo.
 */
export async function handleGroupPromoteCommand({
  sock,
  chatJid,
  userJid,
  isGroup,
  args = [],
  mentionedJids = [],
  quotedParticipant = '',
  reply,
}) {
  const perm = await validateGroupAdminPermissions({ sock, chatJid, userJid, isGroup });
  if (!perm.ok) {
    await reply(perm.message);
    return { handled: true, success: false, reason: perm.reason };
  }

  const targetJid = resolveTargetParticipantJid({ args, mentionedJids, quotedParticipant });
  if (!targetJid) {
    await reply('⚠️ Mencione o usuário (@alvo), responda a uma mensagem dele ou digite o número para promover.');
    return { handled: true, success: false, reason: 'missing-target' };
  }

  const alreadyAdmin = perm.meta
    ? checkAdminInMeta(perm.meta, targetJid)
    : await isGroupAdmin(sock, chatJid, targetJid);
  if (alreadyAdmin) {
    await reply(`ℹ️ ${formatTargetMention(targetJid)} já é administrador deste grupo.`);
    return { handled: true, success: false, reason: 'already-admin' };
  }

  try {
    await updateGroupParticipants({
      sock,
      chatJid,
      participants: [targetJid],
      action: 'promote',
    });

    await reply(`⭐ ${formatTargetMention(targetJid)} agora é administrador do grupo!`);
    return { handled: true, success: true, targetJid };
  } catch (error) {
    const errorMsg = String(error?.message || error);
    await reply(`❌ Erro ao promover membro: ${errorMsg}`);
    return { handled: true, success: false, error: errorMsg };
  }
}

/**
 * /rebaixar — Rebaixa um administrador para membro comum.
 */
export async function handleGroupDemoteCommand({
  sock,
  chatJid,
  userJid,
  isGroup,
  args = [],
  mentionedJids = [],
  quotedParticipant = '',
  reply,
}) {
  const perm = await validateGroupAdminPermissions({ sock, chatJid, userJid, isGroup });
  if (!perm.ok) {
    await reply(perm.message);
    return { handled: true, success: false, reason: perm.reason };
  }

  const targetJid = resolveTargetParticipantJid({ args, mentionedJids, quotedParticipant });
  if (!targetJid) {
    await reply('⚠️ Mencione o usuário (@alvo), responda a uma mensagem dele ou digite o número para rebaixar.');
    return { handled: true, success: false, reason: 'missing-target' };
  }

  if (perm.botJid && isSameUser(targetJid, perm.botJid)) {
    await reply('😅 Não posso rebaixar a mim mesmo!');
    return { handled: true, success: false, reason: 'cannot-demote-bot' };
  }

  const isAdmin = perm.meta
    ? checkAdminInMeta(perm.meta, targetJid)
    : await isGroupAdmin(sock, chatJid, targetJid);
  if (!isAdmin) {
    await reply(`ℹ️ ${formatTargetMention(targetJid)} não é administrador deste grupo.`);
    return { handled: true, success: false, reason: 'not-admin' };
  }

  try {
    await updateGroupParticipants({
      sock,
      chatJid,
      participants: [targetJid],
      action: 'demote',
    });

    await reply(`📉 ${formatTargetMention(targetJid)} não é mais administrador do grupo.`);
    return { handled: true, success: true, targetJid };
  } catch (error) {
    const errorMsg = String(error?.message || error);
    await reply(`❌ Erro ao rebaixar membro: ${errorMsg}`);
    return { handled: true, success: false, error: errorMsg };
  }
}

/**
 * /add — Adiciona um membro ao grupo.
 */
export async function handleGroupAddCommand({
  sock,
  chatJid,
  userJid,
  isGroup,
  args = [],
  mentionedJids = [],
  quotedParticipant = '',
  reply,
}) {
  const perm = await validateGroupAdminPermissions({ sock, chatJid, userJid, isGroup });
  if (!perm.ok) {
    await reply(perm.message);
    return { handled: true, success: false, reason: perm.reason };
  }

  const targetJid = resolveTargetParticipantJid({ args, mentionedJids, quotedParticipant });
  if (!targetJid) {
    await reply('⚠️ Digite o número de telefone com DDI para adicionar. Exemplo: `/add 5511999999999`');
    return { handled: true, success: false, reason: 'missing-target' };
  }

  try {
    const response = await updateGroupParticipants({
      sock,
      chatJid,
      participants: [targetJid],
      action: 'add',
    });

    const statusObj = Array.isArray(response) ? response[0] : response;
    const status = String(statusObj?.status || '');

    if (status === '403') {
      await reply(`⚠️ Não foi possível adicionar ${formatTargetMention(targetJid)} diretamente devido às configurações de privacidade do usuário. Envie um link de convite!`);
      return { handled: true, success: false, reason: 'privacy-restricted' };
    }

    if (status === '409') {
      await reply(`ℹ️ ${formatTargetMention(targetJid)} já é membro deste grupo.`);
      return { handled: true, success: false, reason: 'already-member' };
    }

    if (status === '408') {
      await reply(`⚠️ ${formatTargetMention(targetJid)} saiu recentemente deste grupo e não pode ser adicionado agora.`);
      return { handled: true, success: false, reason: 'left-recently' };
    }

    await reply(`✅ ${formatTargetMention(targetJid)} foi adicionado ao grupo!`);
    return { handled: true, success: true, targetJid };
  } catch (error) {
    const errorMsg = String(error?.message || error);
    await reply(`❌ Erro ao adicionar membro: ${errorMsg}`);
    return { handled: true, success: false, error: errorMsg };
  }
}

/**
 * /fechar — Fecha o grupo para mensagens (apenas admins podem enviar).
 */
export async function handleGroupCloseCommand({
  sock,
  chatJid,
  userJid,
  isGroup,
  reply,
}) {
  const perm = await validateGroupAdminPermissions({ sock, chatJid, userJid, isGroup });
  if (!perm.ok) {
    await reply(perm.message);
    return { handled: true, success: false, reason: perm.reason };
  }

  try {
    await updateGroupSetting({ sock, chatJid, setting: 'announcement' });
    await reply('🔒 *Grupo fechado!*\nApenas administradores podem enviar mensagens agora.');
    return { handled: true, success: true };
  } catch (error) {
    const errorMsg = String(error?.message || error);
    await reply(`❌ Erro ao fechar grupo: ${errorMsg}`);
    return { handled: true, success: false, error: errorMsg };
  }
}

/**
 * /abrir — Abre o grupo para mensagens (todos os membros podem enviar).
 */
export async function handleGroupOpenCommand({
  sock,
  chatJid,
  userJid,
  isGroup,
  reply,
}) {
  const perm = await validateGroupAdminPermissions({ sock, chatJid, userJid, isGroup });
  if (!perm.ok) {
    await reply(perm.message);
    return { handled: true, success: false, reason: perm.reason };
  }

  try {
    await updateGroupSetting({ sock, chatJid, setting: 'not_announcement' });
    await reply('🔓 *Grupo aberto!*\nTodos os membros podem enviar mensagens agora.');
    return { handled: true, success: true };
  } catch (error) {
    const errorMsg = String(error?.message || error);
    await reply(`❌ Erro ao abrir grupo: ${errorMsg}`);
    return { handled: true, success: false, error: errorMsg };
  }
}

/**
 * /trancar — Tranca edições de dados do grupo (apenas admins podem mudar foto, nome, etc.).
 */
export async function handleGroupLockCommand({
  sock,
  chatJid,
  userJid,
  isGroup,
  reply,
}) {
  const perm = await validateGroupAdminPermissions({ sock, chatJid, userJid, isGroup });
  if (!perm.ok) {
    await reply(perm.message);
    return { handled: true, success: false, reason: perm.reason };
  }

  try {
    await updateGroupSetting({ sock, chatJid, setting: 'locked' });
    await reply('🛡️ *Configurações trancadas!*\nApenas administradores podem editar o nome, descrição e foto do grupo.');
    return { handled: true, success: true };
  } catch (error) {
    const errorMsg = String(error?.message || error);
    await reply(`❌ Erro ao trancar configurações do grupo: ${errorMsg}`);
    return { handled: true, success: false, error: errorMsg };
  }
}

/**
 * /destrancar — Destranca edições de dados do grupo (todos podem mudar foto, nome, etc.).
 */
export async function handleGroupUnlockCommand({
  sock,
  chatJid,
  userJid,
  isGroup,
  reply,
}) {
  const perm = await validateGroupAdminPermissions({ sock, chatJid, userJid, isGroup });
  if (!perm.ok) {
    await reply(perm.message);
    return { handled: true, success: false, reason: perm.reason };
  }

  try {
    await updateGroupSetting({ sock, chatJid, setting: 'unlocked' });
    await reply('🔓 *Configurações destrancadas!*\nTodos os membros podem editar os dados e configurações do grupo.');
    return { handled: true, success: true };
  } catch (error) {
    const errorMsg = String(error?.message || error);
    await reply(`❌ Erro ao destrancar configurações do grupo: ${errorMsg}`);
    return { handled: true, success: false, error: errorMsg };
  }
}
