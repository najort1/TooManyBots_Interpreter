import test from 'node:test';
import assert from 'node:assert/strict';

import { parseFunCommand, routeFunCommand } from '../fun/commands/router.js';
import { FUN_COMMANDS } from '../fun/constants.js';
import {
  handleGroupBanCommand,
  handleGroupPromoteCommand,
  handleGroupDemoteCommand,
  handleGroupAddCommand,
  handleGroupCloseCommand,
  handleGroupOpenCommand,
  handleGroupLockCommand,
  handleGroupUnlockCommand,
} from '../fun/commands/handlers/groupAdmin.js';
import {
  getBotJid,
  resolveTargetParticipantJid,
  validateGroupAdminPermissions,
} from '../fun/services/groupAdminService.js';
import { resolveHelpTopic } from '../fun/formatters/helpGuide.js';

function createMockSock({
  botJid = '551188888888@s.whatsapp.net',
  participants = [],
  onParticipantsUpdate = null,
  onSettingUpdate = null,
} = {}) {
  return {
    user: { id: botJid },
    groupMetadata: async (jid) => {
      return {
        id: jid,
        subject: 'Grupo de Teste',
        participants: participants.length > 0 ? participants : [
          { id: botJid, admin: 'admin' },
          { id: '5511999999999@s.whatsapp.net', admin: 'admin' },
          { id: '5511777777777@s.whatsapp.net', admin: null },
        ],
      };
    },
    groupParticipantsUpdate: async (jid, pList, action) => {
      if (onParticipantsUpdate) return onParticipantsUpdate(jid, pList, action);
      return [{ status: '200', jid: pList[0] }];
    },
    groupSettingUpdate: async (jid, setting) => {
      if (onSettingUpdate) return onSettingUpdate(jid, setting);
      return true;
    },
  };
}

test('parseFunCommand mapeia comandos e aliases de admin de grupo (pt e en)', () => {
  assert.equal(parseFunCommand('/ban @user')?.command, FUN_COMMANDS.GROUP_BAN);
  assert.equal(parseFunCommand('/banir @user')?.command, FUN_COMMANDS.GROUP_BAN);
  assert.equal(parseFunCommand('/kick @user')?.command, FUN_COMMANDS.GROUP_BAN);
  assert.equal(parseFunCommand('/expulsar @user')?.command, FUN_COMMANDS.GROUP_BAN);
  assert.equal(parseFunCommand('/remover @user')?.command, FUN_COMMANDS.GROUP_BAN);

  assert.equal(parseFunCommand('/promover @user')?.command, FUN_COMMANDS.GROUP_PROMOTE);
  assert.equal(parseFunCommand('/promote @user')?.command, FUN_COMMANDS.GROUP_PROMOTE);
  assert.equal(parseFunCommand('/admin @user')?.command, FUN_COMMANDS.GROUP_PROMOTE);

  assert.equal(parseFunCommand('/rebaixar @user')?.command, FUN_COMMANDS.GROUP_DEMOTE);
  assert.equal(parseFunCommand('/demote @user')?.command, FUN_COMMANDS.GROUP_DEMOTE);

  assert.equal(parseFunCommand('/add 5511999999999')?.command, FUN_COMMANDS.GROUP_ADD);
  assert.equal(parseFunCommand('/adicionar 5511999999999')?.command, FUN_COMMANDS.GROUP_ADD);
  assert.equal(parseFunCommand('/colocar 5511999999999')?.command, FUN_COMMANDS.GROUP_ADD);

  assert.equal(parseFunCommand('/fechar')?.command, FUN_COMMANDS.GROUP_CLOSE);
  assert.equal(parseFunCommand('/close')?.command, FUN_COMMANDS.GROUP_CLOSE);

  assert.equal(parseFunCommand('/abrir')?.command, FUN_COMMANDS.GROUP_OPEN);
  assert.equal(parseFunCommand('/open')?.command, FUN_COMMANDS.GROUP_OPEN);

  assert.equal(parseFunCommand('/trancar')?.command, FUN_COMMANDS.GROUP_LOCK);
  assert.equal(parseFunCommand('/lock')?.command, FUN_COMMANDS.GROUP_LOCK);

  assert.equal(parseFunCommand('/destrancar')?.command, FUN_COMMANDS.GROUP_UNLOCK);
  assert.equal(parseFunCommand('/unlock')?.command, FUN_COMMANDS.GROUP_UNLOCK);
});

test('routeFunCommand encaminha comandos de admin de grupo corretamente', async () => {
  const sock = createMockSock();
  const replies = [];
  const reply = async (m) => replies.push(m);

  const ctx = {
    text: '/fechar',
    funConfig: { prefix: '/' },
    userJid: '5511999999999@s.whatsapp.net',
    chatJid: '123456@g.us',
    isGroup: true,
    scopeKey: '123456@g.us',
    sock,
    reply,
  };

  const res = await routeFunCommand(ctx);
  assert.equal(res.handled, true);
  assert.equal(res.success, true);
  assert.match(replies.pop(), /Grupo fechado/);
});

test('resolveHelpTopic reconhece tópico admin', () => {
  assert.equal(resolveHelpTopic('admin'), 'admin');
  assert.equal(resolveHelpTopic('adm'), 'admin');
  assert.equal(resolveHelpTopic('mod'), 'admin');
  assert.equal(resolveHelpTopic('administracao'), 'admin');
});

test('getBotJid extrai JID normalizado do socket', () => {
  assert.equal(
    getBotJid({ user: { id: '551199999999:2@s.whatsapp.net' } }),
    '551199999999@s.whatsapp.net'
  );
  assert.equal(
    getBotJid({ authState: { creds: { me: { id: '123456789@lid' } } } }),
    '123456789@lid'
  );
});

test('resolveTargetParticipantJid resolve por menção, quoted e argumento com número', () => {
  assert.equal(
    resolveTargetParticipantJid({ mentionedJids: ['5511111111111@s.whatsapp.net'] }),
    '5511111111111@s.whatsapp.net'
  );
  assert.equal(
    resolveTargetParticipantJid({ quotedParticipant: '5522222222222@s.whatsapp.net' }),
    '5522222222222@s.whatsapp.net'
  );
  assert.equal(
    resolveTargetParticipantJid({ args: ['+55', '(11)', '93333-3333'] }),
    '5511933333333@s.whatsapp.net'
  );
});

test('validateGroupAdminPermissions bloqueia quando não é grupo, quando usuário não é admin ou bot não é admin', async () => {
  const sock = createMockSock();

  // Fora de grupo
  const notGroup = await validateGroupAdminPermissions({
    sock,
    chatJid: '5511999999999@s.whatsapp.net',
    userJid: '5511999999999@s.whatsapp.net',
    isGroup: false,
  });
  assert.equal(notGroup.ok, false);
  assert.equal(notGroup.reason, 'not-group');

  // Usuário não é admin
  const userNotAdmin = await validateGroupAdminPermissions({
    sock,
    chatJid: '123456@g.us',
    userJid: '5511777777777@s.whatsapp.net',
    isGroup: true,
  });
  assert.equal(userNotAdmin.ok, false);
  assert.equal(userNotAdmin.reason, 'user-not-admin');

  // Bot não é admin
  const sockBotNotAdmin = createMockSock({
    participants: [
      { id: '551188888888@s.whatsapp.net', admin: null },
      { id: '5511999999999@s.whatsapp.net', admin: 'admin' },
    ],
  });
  const botNotAdmin = await validateGroupAdminPermissions({
    sock: sockBotNotAdmin,
    chatJid: '123456@g.us',
    userJid: '5511999999999@s.whatsapp.net',
    isGroup: true,
  });
  assert.equal(botNotAdmin.ok, false);
  assert.equal(botNotAdmin.reason, 'bot-not-admin');

  // Sucesso
  const okPerm = await validateGroupAdminPermissions({
    sock,
    chatJid: '123456@g.us',
    userJid: '5511999999999@s.whatsapp.net',
    isGroup: true,
  });
  assert.equal(okPerm.ok, true);
});

test('handleGroupBanCommand remove participante com sucesso e protege bot e o próprio executor', async () => {
  let removed = null;
  const sock = createMockSock({
    onParticipantsUpdate: async (jid, pList, action) => {
      removed = { jid, pList, action };
      return [{ status: '200' }];
    },
  });

  const replies = [];
  const reply = async (msg) => replies.push(msg);

  // Tentativa de banir sem alvo
  await handleGroupBanCommand({
    sock,
    chatJid: '123456@g.us',
    userJid: '5511999999999@s.whatsapp.net',
    isGroup: true,
    reply,
  });
  assert.match(replies.pop(), /Mencione o usuário/);

  // Tentativa de banir o próprio bot
  await handleGroupBanCommand({
    sock,
    chatJid: '123456@g.us',
    userJid: '5511999999999@s.whatsapp.net',
    isGroup: true,
    mentionedJids: ['551188888888@s.whatsapp.net'],
    reply,
  });
  assert.match(replies.pop(), /não posso remover a mim mesmo/);

  // Tentativa de banir a si mesmo
  await handleGroupBanCommand({
    sock,
    chatJid: '123456@g.us',
    userJid: '5511999999999@s.whatsapp.net',
    isGroup: true,
    mentionedJids: ['5511999999999@s.whatsapp.net'],
    reply,
  });
  assert.match(replies.pop(), /não pode remover a si mesmo/);

  // Remoção com sucesso
  const res = await handleGroupBanCommand({
    sock,
    chatJid: '123456@g.us',
    userJid: '5511999999999@s.whatsapp.net',
    isGroup: true,
    mentionedJids: ['5511777777777@s.whatsapp.net'],
    reply,
  });
  assert.equal(res.success, true);
  assert.equal(removed.action, 'remove');
  assert.equal(removed.pList[0], '5511777777777@s.whatsapp.net');
  assert.match(replies.pop(), /foi removido do grupo/);
});

test('handleGroupPromoteCommand e handleGroupDemoteCommand gerenciam admins com validações', async () => {
  let updatedAction = null;
  const sock = createMockSock({
    onParticipantsUpdate: async (jid, pList, action) => {
      updatedAction = action;
      return [{ status: '200' }];
    },
  });

  const replies = [];
  const reply = async (msg) => replies.push(msg);

  // Promover usuário que já é admin
  await handleGroupPromoteCommand({
    sock,
    chatJid: '123456@g.us',
    userJid: '5511999999999@s.whatsapp.net',
    isGroup: true,
    mentionedJids: ['5511999999999@s.whatsapp.net'],
    reply,
  });
  assert.match(replies.pop(), /já é administrador/);

  // Promover membro comum
  const promoteRes = await handleGroupPromoteCommand({
    sock,
    chatJid: '123456@g.us',
    userJid: '5511999999999@s.whatsapp.net',
    isGroup: true,
    mentionedJids: ['5511777777777@s.whatsapp.net'],
    reply,
  });
  assert.equal(promoteRes.success, true);
  assert.equal(updatedAction, 'promote');
  assert.match(replies.pop(), /agora é administrador/);

  // Rebaixar membro comum (que não é admin)
  await handleGroupDemoteCommand({
    sock,
    chatJid: '123456@g.us',
    userJid: '5511999999999@s.whatsapp.net',
    isGroup: true,
    mentionedJids: ['5511777777777@s.whatsapp.net'],
    reply,
  });
  assert.match(replies.pop(), /não é administrador/);

  // Rebaixar o próprio bot
  await handleGroupDemoteCommand({
    sock,
    chatJid: '123456@g.us',
    userJid: '5511999999999@s.whatsapp.net',
    isGroup: true,
    mentionedJids: ['551188888888@s.whatsapp.net'],
    reply,
  });
  assert.match(replies.pop(), /Não posso rebaixar a mim mesmo/);

  // Rebaixar admin válido
  const demoteRes = await handleGroupDemoteCommand({
    sock,
    chatJid: '123456@g.us',
    userJid: '5511999999999@s.whatsapp.net',
    isGroup: true,
    mentionedJids: ['5511999999999@s.whatsapp.net'],
    reply,
  });
  assert.equal(demoteRes.success, true);
  assert.equal(updatedAction, 'demote');
  assert.match(replies.pop(), /não é mais administrador/);
});

test('handleGroupAddCommand trata status de retorno do Baileys e sucesso', async () => {
  const replies = [];
  const reply = async (msg) => replies.push(msg);

  // Falha privacidade 403
  const sock403 = createMockSock({
    onParticipantsUpdate: async () => [{ status: '403' }],
  });
  await handleGroupAddCommand({
    sock: sock403,
    chatJid: '123456@g.us',
    userJid: '5511999999999@s.whatsapp.net',
    isGroup: true,
    args: ['5511911112222'],
    reply,
  });
  assert.match(replies.pop(), /configurações de privacidade/);

  // Sucesso 200
  const sock200 = createMockSock({
    onParticipantsUpdate: async () => [{ status: '200' }],
  });
  const addRes = await handleGroupAddCommand({
    sock: sock200,
    chatJid: '123456@g.us',
    userJid: '5511999999999@s.whatsapp.net',
    isGroup: true,
    args: ['5511911112222'],
    reply,
  });
  assert.equal(addRes.success, true);
  assert.match(replies.pop(), /foi adicionado ao grupo/);
});

test('handleGroupClose, handleGroupOpen, handleGroupLock e handleGroupUnlock alteram configurações', async () => {
  let lastSetting = null;
  const sock = createMockSock({
    onSettingUpdate: async (jid, setting) => {
      lastSetting = setting;
      return true;
    },
  });

  const replies = [];
  const reply = async (msg) => replies.push(msg);
  const base = {
    sock,
    chatJid: '123456@g.us',
    userJid: '5511999999999@s.whatsapp.net',
    isGroup: true,
    reply,
  };

  // Fechar grupo (announcement)
  await handleGroupCloseCommand(base);
  assert.equal(lastSetting, 'announcement');
  assert.match(replies.pop(), /Grupo fechado/);

  // Abrir grupo (not_announcement)
  await handleGroupOpenCommand(base);
  assert.equal(lastSetting, 'not_announcement');
  assert.match(replies.pop(), /Grupo aberto/);

  // Trancar configurações (locked)
  await handleGroupLockCommand(base);
  assert.equal(lastSetting, 'locked');
  assert.match(replies.pop(), /Configurações trancadas/);

  // Destrancar configurações (unlocked)
  await handleGroupUnlockCommand(base);
  assert.equal(lastSetting, 'unlocked');
  assert.match(replies.pop(), /Configurações destrancadas/);
});
