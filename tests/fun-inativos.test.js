import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import { createFunStatsRepository } from '../fun/db/funStatsRepository.js';
import { createFunModule, parseFunCommand } from '../fun/index.js';
import { handleInativosCommand } from '../fun/commands/handlers/inativos.js';
import { routeFunCommand } from '../fun/commands/router.js';
import { FUN_COMMANDS, FUN_COMMAND_ALIASES } from '../fun/constants.js';

await initDb();

let groupCounter = 0;
function uniqueGroup() {
  groupCounter += 1;
  return `120363ine${String(Date.now()).slice(-8)}${String(groupCounter).padStart(4, '0')}@g.us`;
}

let jidCounter = 0;
function uniqueJid(seed) {
  jidCounter += 1;
  return `551188${String(Date.now()).slice(-6)}${String(jidCounter).padStart(4, '0')}${seed || ''}@s.whatsapp.net`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

test('parseFunCommand: /inativos e aliases', () => {
  assert.equal(FUN_COMMAND_ALIASES.inativos, FUN_COMMANDS.INATIVOS);
  assert.equal(FUN_COMMAND_ALIASES.quietos, FUN_COMMANDS.INATIVOS);
  assert.equal(parseFunCommand('/inativos', '/').command, FUN_COMMANDS.INATIVOS);
  assert.equal(parseFunCommand('/quietos', '/').command, FUN_COMMANDS.INATIVOS);
});

test('catalog: /inativos e /atualizacao registrados na categoria perfil, habilitados', async () => {
  const { COMMAND_CATALOG, getAllCommandIds, getDefaultDisabledCommandIds } = await import('../fun/commands/catalog.js');
  const all = getAllCommandIds();
  assert.ok(all.includes(FUN_COMMANDS.INATIVOS));
  assert.ok(all.includes(FUN_COMMANDS.ATUALIZACAO));
  const inativos = COMMAND_CATALOG.find((c) => c.id === FUN_COMMANDS.INATIVOS);
  const atualizacao = COMMAND_CATALOG.find((c) => c.id === FUN_COMMANDS.ATUALIZACAO);
  assert.equal(inativos?.category, 'perfil');
  assert.equal(atualizacao?.category, 'perfil');
  assert.equal(getDefaultDisabledCommandIds().includes(FUN_COMMANDS.INATIVOS) === false, true);
  assert.equal(getDefaultDisabledCommandIds().includes(FUN_COMMANDS.ATUALIZACAO) === false, true);
});

test('getInactiveMembers: ordena ASC com empate por last_xp_at ASC e inclui message_count=0', () => {
  const repo = createFunStatsRepository({ getDatabase: getDb });
  const group = uniqueGroup();
  const now = Date.now();

  const ativo = uniqueJid('a');
  const meio1 = uniqueJid('b');
  const meio2 = uniqueJid('c');
  const nunca = uniqueJid('d');

  repo.awardXp({ userJid: ativo, scopeKey: group, amount: 30, now: now - 1 * DAY_MS });
  repo.awardXp({ userJid: ativo, scopeKey: group, amount: 10, now: now - 0.5 * DAY_MS });

  // empate de message_count = 1: quem XP'ou há MENOS tempo (meio1) perde p/ quem XP'ou mais antigo?
  // contrato: mais-inativo-primeiro ⇒ empate por last_xp_at ASC (mais antigo primeiro)
  repo.awardXp({ userJid: meio2, scopeKey: group, amount: 20, now: now - 5 * DAY_MS });
  repo.awardXp({ userJid: meio1, scopeKey: group, amount: 20, now: now - 2 * DAY_MS });

  // garante linha com message_count = 0 (nunca XP'ou)
  repo.ensureUserRow(nunca, group, now);

  const entries = repo.getInactiveMembers(group, { limit: 10 });
  const jids = entries.map((e) => e.userJid);

  // quem tem 0 msgs é o mais inativo → primeiro
  assert.equal(jids[0], nunca);
  // empate (1 msg cada): o de last_xp_at mais ANTIGO vem primeiro
  assert.equal(jids[1], meio2);
  assert.equal(jids[2], meio1);
  assert.equal(jids[3], ativo);

  // rank 1-based
  assert.equal(entries[0].rank, 1);
  assert.equal(entries[3].rank, 4);
  // mapa igual a mapStatsRow
  assert.equal(entries[3].messageCount, 2);
  assert.equal(typeof entries[3].lastXpAt, 'number');
});

test('getInactiveMembers: limit clamped 1..50', () => {
  const repo = createFunStatsRepository({ getDatabase: getDb });
  const group = uniqueGroup();
  const now = Date.now();
  for (let i = 0; i < 55; i += 1) {
    repo.ensureUserRow(uniqueJid(`con${i}`), group, now - i * 1_000);
  }
  // 52 membros no scope
  assert.equal(
    repo.getDatabase().prepare('SELECT COUNT(*) AS n FROM analytics.fun_user_stats WHERE scope_key = ?').get(group).n,
    55
  );
  // max 50
  assert.equal(repo.getInactiveMembers(group, { limit: 500 }).length, 50);
  // limit 0 cai no default 10 (convenção de getLeaderboard)
  assert.equal(repo.getInactiveMembers(group, { limit: 0 }).length, 10);
  // limit 1 → 1
  assert.equal(repo.getInactiveMembers(group, { limit: 1 }).length, 1);
});

test('getInactiveMembers via rankService (facade)', () => {
  const group = uniqueGroup();
  const mod = createFunModule({ getConfig: () => ({ enabled: false }) });
  const svc = mod._services.rankService;
  assert.equal(typeof svc.getInactiveMembers, 'function');
  const entries = svc.getInactiveMembers(group, { limit: 10 });
  assert.ok(Array.isArray(entries));
});

test('handler /inativos: formata N msgs, última fala e menção do autor', async () => {
  const repo = createFunStatsRepository({ getDatabase: getDb });
  const group = uniqueGroup();
  const now = Date.now();

  const silencioso = uniqueJid('s');
  const tagarela = uniqueJid('t');
  repo.ensureUserRow(silencioso, group, now - 8 * DAY_MS);
  repo.awardXp({ userJid: tagarela, scopeKey: group, amount: 15, now: now - 2 * 3_600_000 });
  repo.awardXp({ userJid: tagarela, scopeKey: group, amount: 15, now: now - 1 * 3_600_000 });

  const svc = { getInactiveMembers: (scope, opts) => repo.getInactiveMembers(scope, opts), getUserMessagesRankPosition: (u, s) => repo.getUserMessagesRankPosition(u, s) };

  const replies = [];
  const res = await handleInativosCommand({
    userJid: silencioso,
    scopeKey: group,
    rankService: svc,
    funConfig: { rankLimit: 10, worldTimezone: 'America/Sao_Paulo' },
    getContactDisplayName: (jid) => (jid === tagarela ? 'Tagarela' : 'Silencioso'),
    reply: async (msg) => { replies.push(String(msg)); },
    effectiveRates: {},
    now,
  });

  assert.equal(res.handled, true);
  const tagarelaLocal = tagarela.split('@')[0];
  const silenciosoLocal = silencioso.split('@')[0];
  const out = replies.join('\n');
  assert.match(out, /😴 \*MENOS ATIVOS\*/);
  // silencioso (0 msgs) aparece antes do tagarela
  assert.ok(out.indexOf(silenciosoLocal) < out.indexOf(tagarelaLocal));
  assert.match(out, /\*0\* msgs/);
  assert.match(out, /\*2\* msgs/);
  // última fala relativa: tagarela fala há ~1h (há Xh); silencioso (0 msgs) exibe 'nunca falou'
  assert.match(out, /há \d+h/);
  assert.match(out, /nunca falou/);
});


test('handler /inativos via router: povoa e responde no grupo', async () => {
  const repo = createFunStatsRepository({ getDatabase: getDb });
  const group = uniqueGroup();
  const author = uniqueJid('a');
  const quiet = uniqueJid('q');
  repo.awardXp({ userJid: author, scopeKey: group, amount: 10, now: Date.now() - 30_000 });
  repo.ensureUserRow(quiet, group, Date.now() - 5 * DAY_MS);

  const replies = [];
  const res = await routeFunCommand({
    text: '/inativos',
    chatJid: group,
    scopeKey: group,
    userJid: author,
    isGroup: true,
    funConfig: { prefix: '/', rankLimit: 10, worldTimezone: 'America/Sao_Paulo' },
    effectiveRates: { disabledCommands: [], permitirNsfw: false, rankLimit: 10 },
    reply: async (msg) => { replies.push(String(msg)); },
    getContactDisplayName: (jid) => (jid === author ? 'Autor' : 'Quieto'),
    rankService: {
      getInactiveMembers: (scope, opts) => repo.getInactiveMembers(scope, opts),
      getUserMessagesRankPosition: (u, s) => repo.getUserMessagesRankPosition(u, s),
    },
  });

  assert.equal(res.handled, true);
  const out = replies.join('\n');
  assert.match(out, /MENOS ATIVOS/);
  assert.match(out, /Quieto|@551188/);
  assert.match(out, /Sua posição no rank de mensagens/);
});

test('group-only: /inativos exibido como comando parseável, catálogo exige habilitação', async () => {
  // o grupo é obrigatório como handlers de rank existentes (sem validação extra no handler);
  // aqui só garantimos que o roteamento reconhece o comando
  const parsed = parseFunCommand('/inativos', '/');
  assert.equal(parsed.command, FUN_COMMANDS.INATIVOS);
});

test('exclusão do bot: bot (JID normal e LID) é excluído do rank mesmo com registro em fun_user_stats', async () => {
  const repo = createFunStatsRepository({ getDatabase: getDb });
  const group = uniqueGroup();
  const now = Date.now();

  const botJid = '5511987654321@s.whatsapp.net';
  const botLid = '9876543210123@lid';
  const user1 = uniqueJid('u1');
  const user2 = uniqueJid('u2');

  // Bot com 0 msgs (normalmente ficaria em 1º lugar no rank de inativos)
  repo.ensureUserRow(botJid, group, now - 10 * DAY_MS);
  repo.ensureUserRow(botLid, group, now - 9 * DAY_MS);

  // Usuários humanos com mensagens
  repo.awardXp({ userJid: user1, scopeKey: group, amount: 15, now: now - 3 * DAY_MS });
  repo.awardXp({ userJid: user2, scopeKey: group, amount: 30, now: now - 1 * DAY_MS });

  // 1. Verificação no repositório com excludeJids
  const repoEntries = repo.getInactiveMembers(group, {
    limit: 10,
    excludeJids: [botJid, botLid],
  });
  const repoJids = repoEntries.map((e) => e.userJid);
  assert.ok(!repoJids.includes(botJid), 'botJid não deve estar nas entradas do repo');
  assert.ok(!repoJids.includes(botLid), 'botLid não deve estar nas entradas do repo');
  assert.ok(repoJids.includes(user1));
  assert.ok(repoJids.includes(user2));

  // 2. Verificação no handler com sock, identityMap e funConfig
  const replies = [];
  const identityMap = {
    resolve: (jid) => (jid === botLid ? botJid : jid),
  };
  const sock = {
    user: { id: '5511987654321:1@s.whatsapp.net', lid: botLid },
  };

  const res = await handleInativosCommand({
    userJid: user1,
    scopeKey: group,
    rankService: {
      getInactiveMembers: (s, opts) => repo.getInactiveMembers(s, opts),
      getUserMessagesRankPosition: (u, s) => repo.getUserMessagesRankPosition(u, s),
    },
    funConfig: { botJid, rankLimit: 10, worldTimezone: 'America/Sao_Paulo' },
    sock,
    identityMap,
    getContactDisplayName: (jid) => {
      if (jid === botJid || jid === botLid) return 'Dudu Bot';
      if (jid === user1) return 'User Um';
      return 'User Dois';
    },
    reply: async (msg) => { replies.push(String(msg)); },
    now,
  });

  assert.equal(res.handled, true);
  const out = replies.join('\n');
  assert.doesNotMatch(out, /5511987654321/);
  assert.doesNotMatch(out, /9876543210123/);
  assert.match(out, new RegExp(user1.split('@')[0]));
  assert.match(out, new RegExp(user2.split('@')[0]));
});

test('exclusão de números de teste: JIDs 5511999* são excluídos no SQL e no handler', async () => {
  const repo = createFunStatsRepository({ getDatabase: getDb });
  const group = uniqueGroup();
  const now = Date.now();

  const testNum1 = '55119998616956@s.whatsapp.net';
  const testNum2 = '55119998328722@s.whatsapp.net';
  const realUser1 = uniqueJid('real1');
  const realUser2 = uniqueJid('real2');

  // Números de teste com 0 msgs (que apareciam no topo do print do usuário)
  repo.ensureUserRow(testNum1, group, now - 15 * DAY_MS);
  repo.ensureUserRow(testNum2, group, now - 12 * DAY_MS);

  // Usuários reais
  repo.ensureUserRow(realUser1, group, now - 5 * DAY_MS);
  repo.awardXp({ userJid: realUser2, scopeKey: group, amount: 20, now: now - 1 * DAY_MS });

  // Verificação no repositório (filtro SQL direto)
  const repoEntries = repo.getInactiveMembers(group, { limit: 10 });
  const repoJids = repoEntries.map((e) => e.userJid);
  assert.ok(!repoJids.includes(testNum1), 'testNum1 deve ser excluído pelo repositório');
  assert.ok(!repoJids.includes(testNum2), 'testNum2 deve ser excluído pelo repositório');
  assert.ok(repoJids.includes(realUser1));
  assert.ok(repoJids.includes(realUser2));

  // Verificação no handler
  const replies = [];
  const res = await handleInativosCommand({
    userJid: realUser1,
    scopeKey: group,
    rankService: {
      getInactiveMembers: (s, opts) => repo.getInactiveMembers(s, opts),
      getUserMessagesRankPosition: (u, s) => repo.getUserMessagesRankPosition(u, s),
    },
    funConfig: { rankLimit: 10, worldTimezone: 'America/Sao_Paulo' },
    getContactDisplayName: (jid) => {
      if (jid.startsWith('5511999')) return `Teste ${jid.slice(0, 10)}`;
      if (jid === realUser1) return 'Real Um';
      return 'Real Dois';
    },
    reply: async (msg) => { replies.push(String(msg)); },
    now,
  });

  assert.equal(res.handled, true);
  const out = replies.join('\n');
  assert.doesNotMatch(out, /55119998616956/);
  assert.doesNotMatch(out, /55119998328722/);
  assert.match(out, new RegExp(realUser1.split('@')[0]));
  assert.match(out, new RegExp(realUser2.split('@')[0]));
});

test('sequencialidade do ranking: posições permanecem 1, 2, 3... após exclusão do bot e números de teste', async () => {
  const repo = createFunStatsRepository({ getDatabase: getDb });
  const group = uniqueGroup();
  const now = Date.now();

  const botJid = '5511981112233@s.whatsapp.net';
  const testNum = '5511999000111@s.whatsapp.net';
  const u1 = uniqueJid('seq1');
  const u2 = uniqueJid('seq2');
  const u3 = uniqueJid('seq3');
  const u4 = uniqueJid('seq4');

  // Bot e teste com 0 msgs (estariam nas posições 1 e 2 se não filtrados)
  repo.ensureUserRow(botJid, group, now - 20 * DAY_MS);
  repo.ensureUserRow(testNum, group, now - 19 * DAY_MS);

  // Usuários válidos
  repo.ensureUserRow(u1, group, now - 10 * DAY_MS); // 0 msgs -> deve ser 1º
  repo.awardXp({ userJid: u2, scopeKey: group, amount: 10, now: now - 5 * DAY_MS }); // 1 msg -> deve ser 2º
  repo.awardXp({ userJid: u3, scopeKey: group, amount: 20, now: now - 3 * DAY_MS }); // 1 msg -> deve ser 3º
  repo.awardXp({ userJid: u4, scopeKey: group, amount: 50, now: now - 1 * DAY_MS }); // 1 msg -> deve ser 4º

  const replies = [];
  await handleInativosCommand({
    userJid: u1,
    scopeKey: group,
    rankService: {
      getInactiveMembers: (s, opts) => repo.getInactiveMembers(s, opts),
      getUserMessagesRankPosition: (u, s) => repo.getUserMessagesRankPosition(u, s),
    },
    funConfig: { botJid, rankLimit: 10, worldTimezone: 'America/Sao_Paulo' },
    getContactDisplayName: (jid) => {
      if (jid === u1) return 'Primeiro';
      if (jid === u2) return 'Segundo';
      if (jid === u3) return 'Terceiro';
      if (jid === u4) return 'Quarto';
      return jid;
    },
    reply: async (msg) => { replies.push(String(msg)); },
    now,
  });

  const out = replies.join('\n');
  const lines = out.split('\n').filter((l) => l.trim().length > 0);
  const u1Local = u1.split('@')[0];
  const u2Local = u2.split('@')[0];
  const u3Local = u3.split('@')[0];
  const u4Local = u4.split('@')[0];
  assert.ok(lines.some((l) => l.startsWith('🥇') && l.includes(u1Local)), 'Deve começar com 🥇 para Primeiro');
  assert.ok(lines.some((l) => l.startsWith('🥈') && l.includes(u2Local)), 'Deve ter 🥈 para Segundo');
  assert.ok(lines.some((l) => l.startsWith('🥉') && l.includes(u3Local)), 'Deve ter 🥉 para Terceiro');
  assert.ok(lines.some((l) => l.startsWith('4.') && l.includes(u4Local)), 'Deve ter 4. para Quarto');

  // Não deve conter linhas com o bot ou número de teste
  assert.doesNotMatch(out, /5511981112233/);
  assert.doesNotMatch(out, /5511999000111/);
});
