import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import { ensureFunSchema } from '../fun/schema.js';
import { createChangelogService } from '../fun/services/changelogService.js';
import { handleAtualizacaoCommand } from '../fun/commands/handlers/atualizacao.js';
import { parseFunCommand } from '../fun/commands/router.js';
import { FUN_COMMANDS, FUN_COMMAND_ALIASES } from '../fun/constants.js';

await initDb();
ensureFunSchema(getDb());

function uniqueGroup() {
  return `120363${String(Date.now()).slice(-10)}${Math.floor(Math.random() * 90 + 10)}@g.us`;
}

function createBroadcastRow(svc, input, createdAt) {
  // broadcast dry-run grava linha em fun_changelog_broadcasts (com dry_run=1)
  return svc.broadcast({ ...input, dryRun: true, funConfig: { groupWhitelistJids: [uniqueGroup()] } });
}

function fakeSock() {
  return { sendMessage: async () => ({ key: { id: `fake-${Math.random()}` } }) };
}

test('parseFunCommand: /atualizacao e aliases registrados', () => {
  assert.equal(FUN_COMMAND_ALIASES.atualizacao, FUN_COMMANDS.ATUALIZACAO);
  assert.equal(parseFunCommand('/atualizacao', '/').command, FUN_COMMANDS.ATUALIZACAO);
});

test('getLastBroadcast: vazio → null (sem broadcasts no escopo do teste)', () => {
  const svc = createChangelogService({
    getDatabase: getDb,
    getConfig: () => ({}),
    getSock: () => null,
    sendText: async () => {},
  });
  const db = getDb();
  db.prepare('DELETE FROM analytics.fun_changelog_broadcasts').run();
  const semAntes = svc.getLastBroadcast();
  assert.equal(semAntes, null);
});

test('getLastBroadcast: retorna a mensagem REAL e ignora dry_run posterior', async () => {
  const svc = createChangelogService({
    getDatabase: getDb,
    getConfig: () => ({}),
    getSock: () => fakeSock(),
    sendText: async (sock, jid, text) => ({ key: { id: `fake-${jid}` } }),
    sleep: async () => {},
  });

  const real = await svc.broadcast({
    title: 'Novidades do bot',
    version: '2.1',
    body: '- / comando novo\n- ajuste de custo',
    funConfig: { groupWhitelistJids: [uniqueGroup()] },
  });
  assert.equal(real.ok, true);
  assert.equal(real.dryRun, false);

  // dry_run "mais recente" NÃO deve vencer a real
  await createBroadcastRow(svc, { title: 'Ensaio', body: 'corpo do ensaio' }, Date.now());

  const last = svc.getLastBroadcast();
  assert.ok(last);
  assert.equal(last.dryRun, false);
  assert.ok(last.okCount > 0);
  assert.equal(last.id, real.id);
  assert.match(last.messageText, /📢 \*Atualização\*/);
  assert.match(last.messageText, /\*Novidades do bot\*/);
  assert.match(last.messageText, /\/ comando novo/);
});

test('getLastBroadcast: ok_count = 0 não é anúncio real', async () => {
  const svc = createChangelogService({
    getDatabase: getDb,
    getConfig: () => ({}),
    getSock: () => null,
    sendText: async () => { throw new Error('api offline'); },
  });
  const failed = await svc.broadcast({
    title: 'Falhou',
    body: 'corpo falho',
    funConfig: { groupWhitelistJids: [uniqueGroup()] },
  });
  // falha em todos → ok:false
  assert.equal(failed.ok, false);
  const last = svc.getLastBroadcast();
  assert.ok(!last || last.id !== failed.id, 'falha total não pode aparecer como último anúncio');
});

test('getLastBroadcast: mapeia campos igual listHistory', () => {
  const svc = createChangelogService({ getDatabase: getDb });
  const last = svc.getLastBroadcast();
  if (last) {
    for (const key of ['id', 'title', 'version', 'body', 'messageText', 'targetCount', 'okCount', 'failCount', 'dryRun', 'results', 'createdAt']) {
      assert.ok(Object.hasOwn(last, key), `campo ${key} presente`);
    }
    assert.equal(typeof last.dryRun, 'boolean');
    assert.ok(Array.isArray(last.results));
  }
});

test('getLastBroadcast exposto no serviço do módulo Fun (facade)', async () => {
  const { createFunModule } = await import('../fun/index.js');
  const mod = createFunModule({ getConfig: () => ({ enabled: false }) });
  assert.equal(typeof mod.listLastChangelogBroadcast, 'function');
});

test('handler /atualizacao: responde com o messageText pronto', async () => {
  const svc = createChangelogService({
    getDatabase: getDb,
    getConfig: () => ({}),
    getSock: () => fakeSock(),
    sendText: async (sock, jid, text) => ({ key: { id: `${jid}-${text.length}` } }),
    sleep: async () => {},
  });
  const broadcast = await svc.broadcast({
    title: 'Marquee',
    body: 'linha de teste 42',
    funConfig: { groupWhitelistJids: [uniqueGroup()] },
  });
  assert.equal(broadcast.ok, true);

  const replies = [];
  const res = await handleAtualizacaoCommand({
    changelogService: svc,
    funConfig: { worldTimezone: 'America/Sao_Paulo' },
    reply: async (msg) => { replies.push(String(msg)); },
  });
  assert.equal(res.handled, true);
  assert.equal(replies.length, 1);
  assert.match(replies[0], /Marquee/);
  assert.match(replies[0], /linha de teste 42/);
});

test('handler /atualizacao: sem dados responde amigável, sem erro', async () => {
  const emptyChangelog = { getLastBroadcast: () => null };
  const replies = [];
  const res = await handleAtualizacaoCommand({
    changelogService: emptyChangelog,
    funConfig: {},
    reply: async (msg) => { replies.push(String(msg)); },
  });
  assert.equal(res.handled, true);
  assert.equal(replies.length, 1);
  assert.match(replies[0], /Nenhuma atualização/i);
});
