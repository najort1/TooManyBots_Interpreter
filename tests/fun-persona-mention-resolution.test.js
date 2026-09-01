import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveMentionedUsers,
  resolveMentionsInText,
  buildMentionedUsersContextBlock,
} from '../fun/utils/mentionResolver.js';
import { buildExpandedPromptContext } from '../fun/services/extractionAdapters/promptContextBuilder.js';

test('resolveMentionedUsers resolve JID para nome legível', () => {
  const map = resolveMentionedUsers(
    ['551199999999@s.whatsapp.net'],
    (jid) => (jid.startsWith('551199999999') ? 'Eduardo' : ''),
    'grupo@g.us'
  );

  assert.equal(map.size, 1);
  const user = map.get('551199999999@s.whatsapp.net');
  assert.equal(user.displayName, 'Eduardo');
  assert.equal(user.localPart, '551199999999');
});

test('resolveMentionsInText substitui @numero por @Nome', () => {
  const map = resolveMentionedUsers(
    ['551199999999@s.whatsapp.net'],
    () => 'Eduardo',
    'grupo@g.us'
  );

  const resolved = resolveMentionsInText(
    'bot o que tu acha de @551199999999, fala dele ai',
    map
  );

  assert.equal(resolved, 'bot o que tu acha de @Eduardo, fala dele ai');
});

test('resolveMentionsInText preserva texto quando menção não é encontrada', () => {
  const map = resolveMentionedUsers(
    ['551199999999@s.whatsapp.net'],
    () => 'Eduardo',
    'grupo@g.us'
  );

  const resolved = resolveMentionsInText('bot o que acha do Eduardo?', map);
  assert.equal(resolved, 'bot o que acha do Eduardo?');
});

test('buildMentionedUsersContextBlock inclui identidade mesmo sem perfil', () => {
  const map = resolveMentionedUsers(
    ['551199999999@s.whatsapp.net'],
    () => 'Eduardo',
    'grupo@g.us'
  );

  const block = buildMentionedUsersContextBlock(map, {
    getProfile: () => ({ empty: true }),
    scopeKey: 'grupo@g.us',
  });

  assert.match(block, /Membro mencionado: Eduardo/);
  assert.match(block, /JID: 551199999999/);
  assert.match(block, /Sem perfil preenchido/);
});

test('buildMentionedUsersContextBlock filtra fatos pelo sujeito mencionado', () => {
  const eduardoJid = '551199999999@s.whatsapp.net';
  const pauloJid = '551188888888@s.whatsapp.net';
  const map = resolveMentionedUsers([eduardoJid], () => 'Eduardo', 'grupo@g.us');

  const block = buildMentionedUsersContextBlock(map, {
    getProfile: () => ({ empty: false, nickname: 'Dudu', bio: 'Figura do grupo' }),
    scopeKey: 'grupo@g.us',
    loreFacts: [
      {
        kind: 'running_gag',
        summary: 'Eduardo odeia GTA por causa da Lucia',
        subjects: [eduardoJid],
      },
      {
        kind: 'epic_fail',
        summary: 'Paulo caiu da cadeira',
        subjects: [pauloJid],
      },
    ],
  });

  assert.match(block, /Eduardo odeia GTA/);
  assert.doesNotMatch(block, /Paulo caiu da cadeira/);
});

test('buildExpandedPromptContext inclui usuário mencionado e fatos dele', () => {
  const eduardoJid = '551199999999@s.whatsapp.net';

  const block = buildExpandedPromptContext({
    scopeKey: 'grupo@g.us',
    authorJid: '551177777777@s.whatsapp.net',
    authorProfile: { nickname: 'Giliard' },
    mentionedJids: [eduardoJid],
    getDisplayName: () => 'Eduardo',
    getProfile: () => ({
      empty: false,
      nickname: 'Dudu',
      bio: 'Sempre na treta da panelinha',
      extras: 'odeia GTA por causa da Lucia',
    }),
    loreFacts: [
      {
        kind: 'running_gag',
        summary: 'Eduardo dedica textos épicos no grupo',
        subjects: [eduardoJid],
      },
    ],
  });

  assert.match(block, /<mentioned_users>/);
  assert.match(block, /Membro mencionado: Eduardo/);
  assert.match(block, /Apelido no grupo: "Dudu"/);
  assert.match(block, /Eduardo dedica textos épicos/);
});
