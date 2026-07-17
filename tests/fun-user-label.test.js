import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createUserFormatter,
  formatUserLabel,
  nameOf,
  runWithUserLabels,
  jidLocalPart,
  normalizeMentionJid,
  ensureActorMention,
} from '../fun/utils/userLabel.js';
import { resolveFunConfig } from '../fun/config.js';
import { DEFAULT_FUN_CONFIG } from '../fun/constants.js';

test('mentionUsers default true na config', () => {
  assert.equal(DEFAULT_FUN_CONFIG.mentionUsers, true);
  assert.equal(resolveFunConfig({}).mentionUsers, true);
  assert.equal(resolveFunConfig({ mentionUsers: false }).mentionUsers, false);
});

test('replyQuoted default true na config', () => {
  assert.equal(DEFAULT_FUN_CONFIG.replyQuoted, true);
  assert.equal(resolveFunConfig({}).replyQuoted, true);
  assert.equal(resolveFunConfig({ replyQuoted: false }).replyQuoted, false);
});

test('formatUserLabel: menção com @numero', () => {
  const jid = '5511999887766@s.whatsapp.net';
  const tracked = [];
  const label = formatUserLabel(jid, {
    mention: true,
    getContactDisplayName: () => 'João',
    track: (j) => tracked.push(j),
  });
  assert.equal(label, '@5511999887766');
  assert.deepEqual(tracked, [jid]);
});

test('formatUserLabel: mention off usa nome', () => {
  const jid = '5511999887766@s.whatsapp.net';
  const label = formatUserLabel(jid, {
    mention: false,
    getContactDisplayName: () => 'Maria Silva',
  });
  assert.equal(label, 'Maria Silva');
});

test('createUserFormatter + takeMentions', () => {
  const fmt = createUserFormatter({
    mentionUsers: true,
    getContactDisplayName: () => 'X',
  });
  const a = fmt.formatUser('111@s.whatsapp.net');
  const b = fmt.formatUser('222@s.whatsapp.net');
  assert.equal(a, '@111');
  assert.equal(b, '@222');
  const m = fmt.takeMentions();
  assert.equal(m.length, 2);
  assert.ok(m.includes('111@s.whatsapp.net'));
  assert.equal(fmt.takeMentions().length, 0);
});

test('nameOf usa ALS do formatter', async () => {
  const fmt = createUserFormatter({ mentionUsers: true });
  await runWithUserLabels(fmt, () => {
    assert.equal(nameOf(null, '5511000000000@s.whatsapp.net'), '@5511000000000');
  });
  const mentions = fmt.takeMentions();
  assert.deepEqual(mentions, ['5511000000000@s.whatsapp.net']);
});

test('jid helpers', () => {
  assert.equal(jidLocalPart('55@s.whatsapp.net'), '55');
  assert.equal(normalizeMentionJid('55119998877'), '55119998877@s.whatsapp.net');
  assert.equal(normalizeMentionJid('x@lid'), 'x@lid');
});

test('ensureActorMention: prefixa @ se o handler não citou ninguém', () => {
  const tracked = [];
  const actor = '5511888777666@s.whatsapp.net';
  const out = ensureActorMention('🪙 *Cara ou coroa*\nSaldo: *10*', actor, {
    mentionUsers: true,
    isGroup: true,
    track: (j) => tracked.push(j),
  });
  assert.ok(out.startsWith('@5511888777666\n'));
  assert.ok(out.includes('Cara ou coroa'));
  assert.deepEqual(tracked, [actor]);
});

test('ensureActorMention: não duplica se já tem @ no texto', () => {
  const tracked = [];
  const actor = '5511888777666@s.whatsapp.net';
  const body = '@5511888777666 ganhou *5* coins';
  const out = ensureActorMention(body, actor, {
    mentionUsers: true,
    isGroup: true,
    track: (j) => tracked.push(j),
  });
  assert.equal(out, body);
  assert.deepEqual(tracked, [actor]);
});

test('ensureActorMention: desligado ou DM não prefixa', () => {
  const actor = '5511888777666@s.whatsapp.net';
  const body = 'Saldo: *10*';
  assert.equal(
    ensureActorMention(body, actor, { mentionUsers: false, isGroup: true }),
    body
  );
  assert.equal(
    ensureActorMention(body, actor, { mentionUsers: true, isGroup: false }),
    body
  );
});
