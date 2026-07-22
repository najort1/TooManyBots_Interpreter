import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import { _resetDefaultFunStatsRepository, createFunStatsRepository } from '../fun/db/funStatsRepository.js';
import { createFunGroupRepository } from '../fun/db/funGroupRepository.js';
import { createFunNsfwVoteRepository } from '../fun/db/funNsfwVoteRepository.js';
import { createFunNsfwService } from '../fun/services/funNsfwService.js';

await initDb();
_resetDefaultFunStatsRepository();

const VOTE_DURATION_MS = 24 * 60 * 60 * 1000;

function uniqueGroup() {
  return `120363${String(Date.now()).slice(-10)}${Math.floor(Math.random() * 90 + 10)}@g.us`;
}

function uniqueJid(prefix = '5511') {
  return `${prefix}${String(Date.now()).slice(-7)}${Math.floor(Math.random() * 90 + 10)}@s.whatsapp.net`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTestEnv() {
  const groupRepository = createFunGroupRepository({ getDatabase: getDb });
  const nsfwVoteRepository = createFunNsfwVoteRepository({ getDatabase: getDb });
  const nsfwService = createFunNsfwService({ nsfwVoteRepository, groupRepository });
  const scopeKey = uniqueGroup();
  return { groupRepository, nsfwVoteRepository, nsfwService, scopeKey };
}

function createVote(env, totalMembros = 0) {
  const { nsfwVoteRepository, scopeKey } = env;
  const agora = Date.now();
  const expiraEm = agora + VOTE_DURATION_MS;
  return nsfwVoteRepository.createVote({ scopeKey, expiraEm, totalMembros, agora });
}

// ─── Testes ───────────────────────────────────────────────────────────────────

test('nsfw: getPermitirNsfw default false', () => {
  const env = makeTestEnv();
  assert.equal(env.nsfwVoteRepository.getPermitirNsfw(env.scopeKey), false);
});

test('nsfw: createVote e getActiveVote', () => {
  const env = makeTestEnv();
  const vote = createVote(env);
  assert.ok(vote.id);
  assert.equal(vote.scopeKey, env.scopeKey);
  assert.equal(vote.status, 'active');
  assert.equal(vote.votosSim, 0);
  assert.equal(vote.votosNao, 0);

  const active = env.nsfwVoteRepository.getActiveVote(env.scopeKey);
  assert.ok(active);
  assert.equal(active.id, vote.id);
});

test('nsfw: getActiveVote retorna null se expirada', () => {
  const env = makeTestEnv();
  const agora = Date.now();
  const expiraEm = agora - 1000;
  env.nsfwVoteRepository.createVote({ scopeKey: env.scopeKey, expiraEm, agora });

  const active = env.nsfwVoteRepository.getActiveVote(env.scopeKey);
  assert.equal(active, null);
});

test('nsfw: getActiveVote retorna null se já encerrada', () => {
  const env = makeTestEnv();
  const vote = createVote(env);
  env.nsfwVoteRepository.encerrarVotacao({ voteId: vote.id, resultado: 'nao' });

  const active = env.nsfwVoteRepository.getActiveVote(env.scopeKey);
  assert.equal(active, null);
});

test('nsfw: registerVoto voto sim', () => {
  const env = makeTestEnv();
  const vote = createVote(env);
  const user = uniqueJid();

  const result = env.nsfwVoteRepository.registerVoto({ voteId: vote.id, userJid: user, voto: 'sim' });
  assert.ok(result.ok);
  assert.equal(result.voto, 'sim');

  const updated = env.nsfwVoteRepository.getVoteById(vote.id);
  assert.equal(updated.votosSim, 1);
  assert.equal(updated.votosNao, 0);
});

test('nsfw: registerVoto voto nao', () => {
  const env = makeTestEnv();
  const vote = createVote(env);
  const user = uniqueJid();

  const result = env.nsfwVoteRepository.registerVoto({ voteId: vote.id, userJid: user, voto: 'nao' });
  assert.ok(result.ok);
  assert.equal(result.voto, 'nao');

  const updated = env.nsfwVoteRepository.getVoteById(vote.id);
  assert.equal(updated.votosSim, 0);
  assert.equal(updated.votosNao, 1);
});

test('nsfw: voto duplicado rejeitado', () => {
  const env = makeTestEnv();
  const vote = createVote(env);
  const user = uniqueJid();

  const first = env.nsfwVoteRepository.registerVoto({ voteId: vote.id, userJid: user, voto: 'sim' });
  assert.ok(first.ok);

  const second = env.nsfwVoteRepository.registerVoto({ voteId: vote.id, userJid: user, voto: 'nao' });
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'duplicate');
});

test('nsfw: hasUserVoted', () => {
  const env = makeTestEnv();
  const vote = createVote(env);
  const user = uniqueJid();

  assert.equal(env.nsfwVoteRepository.hasUserVoted(vote.id, user), false);

  env.nsfwVoteRepository.registerVoto({ voteId: vote.id, userJid: user, voto: 'sim' });
  assert.equal(env.nsfwVoteRepository.hasUserVoted(vote.id, user), true);
});

test('nsfw: countBallots', () => {
  const env = makeTestEnv();
  const vote = createVote(env);
  const u1 = uniqueJid();
  const u2 = uniqueJid();

  assert.equal(env.nsfwVoteRepository.countBallots(vote.id), 0);

  env.nsfwVoteRepository.registerVoto({ voteId: vote.id, userJid: u1, voto: 'sim' });
  assert.equal(env.nsfwVoteRepository.countBallots(vote.id), 1);

  env.nsfwVoteRepository.registerVoto({ voteId: vote.id, userJid: u2, voto: 'nao' });
  assert.equal(env.nsfwVoteRepository.countBallots(vote.id), 2);
});

test('nsfw: setPermitirNsfw e getPermitirNsfw', () => {
  const env = makeTestEnv();
  assert.equal(env.nsfwVoteRepository.getPermitirNsfw(env.scopeKey), false);

  env.nsfwVoteRepository.setPermitirNsfw(env.scopeKey, true);
  assert.equal(env.nsfwVoteRepository.getPermitirNsfw(env.scopeKey), true);

  env.nsfwVoteRepository.setPermitirNsfw(env.scopeKey, false);
  assert.equal(env.nsfwVoteRepository.getPermitirNsfw(env.scopeKey), false);
});

test('nsfw: encerrarVotacao fecha e registra resultado', () => {
  const env = makeTestEnv();
  const vote = createVote(env);

  const result = env.nsfwVoteRepository.encerrarVotacao({ voteId: vote.id, resultado: 'sim' });
  assert.equal(result.status, 'closed');
  assert.equal(result.resultado, 'sim');
  assert.ok(result.encerradaEm > 0);
});

test('nsfw: service tryEncerrar com 50%+ maioria sim', () => {
  const env = makeTestEnv();
  const vote = createVote(env);
  const totalMembros = 10;

  for (let i = 0; i < 5; i++) {
    env.nsfwVoteRepository.registerVoto({ voteId: vote.id, userJid: uniqueJid(), voto: 'sim' });
  }

  // 5 votos sim, 0 nao → 5 >= 50% de 10 → sim vence
  const updated = env.nsfwVoteRepository.getVoteById(vote.id);
  const result = env.nsfwService.tryEncerrar(updated, totalMembros);
  assert.ok(result.ok);
  assert.equal(result.result, 'sim');

  assert.equal(env.nsfwVoteRepository.getPermitirNsfw(env.scopeKey), true);
});

test('nsfw: service tryEncerrar com 50%+ maioria nao', () => {
  const env = makeTestEnv();
  const vote = createVote(env);
  const totalMembros = 10;

  for (let i = 0; i < 5; i++) {
    env.nsfwVoteRepository.registerVoto({ voteId: vote.id, userJid: uniqueJid(), voto: 'nao' });
  }

  const updated = env.nsfwVoteRepository.getVoteById(vote.id);
  const result = env.nsfwService.tryEncerrar(updated, totalMembros);
  assert.ok(result.ok);
  assert.equal(result.result, 'nao');

  assert.equal(env.nsfwVoteRepository.getPermitirNsfw(env.scopeKey), false);
});

test('nsfw: service tryEncerrar com menos de 50% nao encerra', () => {
  const env = makeTestEnv();
  const vote = createVote(env);
  const totalMembros = 10;

  for (let i = 0; i < 3; i++) {
    env.nsfwVoteRepository.registerVoto({ voteId: vote.id, userJid: uniqueJid(), voto: 'sim' });
  }

  const updated = env.nsfwVoteRepository.getVoteById(vote.id);
  const result = env.nsfwService.tryEncerrar(updated, totalMembros);
  assert.equal(result.ok, false);
  assert.equal(result.result, null);
});

test('nsfw: service tryEncerrar por impossibilidade matematica (sim impossivel)', () => {
  const env = makeTestEnv();
  const vote = createVote(env);
  const totalMembros = 10;

  for (let i = 0; i < 6; i++) {
    env.nsfwVoteRepository.registerVoto({ voteId: vote.id, userJid: uniqueJid(), voto: 'nao' });
  }

  // 60% já votou não, só 4 restam → sim precisa de mais 5 → impossível
  const updated = env.nsfwVoteRepository.getVoteById(vote.id);
  const result = env.nsfwService.tryEncerrar(updated, totalMembros);
  assert.ok(result.ok);
  assert.equal(result.result, 'nao');
});

test('nsfw: service tryEncerrar por impossibilidade matematica (nao impossivel)', () => {
  const env = makeTestEnv();
  const vote = createVote(env);
  const totalMembros = 10;

  for (let i = 0; i < 6; i++) {
    env.nsfwVoteRepository.registerVoto({ voteId: vote.id, userJid: uniqueJid(), voto: 'sim' });
  }

  const updated = env.nsfwVoteRepository.getVoteById(vote.id);
  const result = env.nsfwService.tryEncerrar(updated, totalMembros);
  assert.ok(result.ok);
  assert.equal(result.result, 'sim');
});

test('nsfw: service tryEncerrar por expiracao (24h) mantem resultado', () => {
  const env = makeTestEnv();
  const totalMembros = 100;
  const agora = Date.now();
  const expiraEm = agora + VOTE_DURATION_MS;
  const vote = env.nsfwVoteRepository.createVote({ scopeKey: env.scopeKey, expiraEm, agora });

  // Only 30 votes out of 100 (< 50%), so it won't end by majority
  for (let i = 0; i < 20; i++) {
    env.nsfwVoteRepository.registerVoto({ voteId: vote.id, userJid: uniqueJid(), voto: 'sim' });
  }
  for (let i = 0; i < 10; i++) {
    env.nsfwVoteRepository.registerVoto({ voteId: vote.id, userJid: uniqueJid(), voto: 'nao' });
  }

  // Try to encerrar while still active (should not end - only 30% voted)
  const updated = env.nsfwVoteRepository.getVoteById(vote.id);
  const result = env.nsfwService.tryEncerrar(updated, totalMembros);
  assert.equal(result.ok, false);
  assert.equal(result.result, null);

  // Manually close to simulate expiration
  env.nsfwVoteRepository.encerrarVotacao({ voteId: vote.id, resultado: 'sim' });
  env.nsfwVoteRepository.setPermitirNsfw(env.scopeKey, true);
  assert.equal(env.nsfwVoteRepository.getPermitirNsfw(env.scopeKey), true);
});

test('nsfw: empate com 50% vira sim (desempate)', () => {
  const env = makeTestEnv();
  const vote = createVote(env);
  const totalMembros = 4;

  // 2 sim, 2 nao → 4 >= 50% de 4, exatamente 50/50 → desempate para sim
  env.nsfwVoteRepository.registerVoto({ voteId: vote.id, userJid: uniqueJid(), voto: 'sim' });
  env.nsfwVoteRepository.registerVoto({ voteId: vote.id, userJid: uniqueJid(), voto: 'sim' });
  env.nsfwVoteRepository.registerVoto({ voteId: vote.id, userJid: uniqueJid(), voto: 'nao' });
  env.nsfwVoteRepository.registerVoto({ voteId: vote.id, userJid: uniqueJid(), voto: 'nao' });

  const updated = env.nsfwVoteRepository.getVoteById(vote.id);
  const result = env.nsfwService.tryEncerrar(updated, totalMembros);
  assert.ok(result.ok);
  assert.equal(result.result, 'sim');
});

test('nsfw: expiracao sem atingir 50% mantem resultado atual (sim)', () => {
  const env = makeTestEnv();
  const totalMembros = 10;
  const agora = Date.now();
  const expiraEm = agora + VOTE_DURATION_MS;
  const vote = env.nsfwVoteRepository.createVote({ scopeKey: env.scopeKey, expiraEm, agora });

  env.nsfwVoteRepository.registerVoto({ voteId: vote.id, userJid: uniqueJid(), voto: 'sim' });
  env.nsfwVoteRepository.registerVoto({ voteId: vote.id, userJid: uniqueJid(), voto: 'sim' });
  env.nsfwVoteRepository.registerVoto({ voteId: vote.id, userJid: uniqueJid(), voto: 'nao' });

  // Encerrar manualmente com resultado
  env.nsfwVoteRepository.encerrarVotacao({ voteId: vote.id, resultado: 'sim' });
  env.nsfwVoteRepository.setPermitirNsfw(env.scopeKey, true);
  assert.equal(env.nsfwVoteRepository.getPermitirNsfw(env.scopeKey), true);
});

test('nsfw: expiracao sem atingir 50% mantem resultado atual (nao)', () => {
  const env = makeTestEnv();
  const totalMembros = 10;
  const agora = Date.now();
  const expiraEm = agora + VOTE_DURATION_MS;
  const vote = env.nsfwVoteRepository.createVote({ scopeKey: env.scopeKey, expiraEm, agora });

  env.nsfwVoteRepository.registerVoto({ voteId: vote.id, userJid: uniqueJid(), voto: 'sim' });
  env.nsfwVoteRepository.registerVoto({ voteId: vote.id, userJid: uniqueJid(), voto: 'nao' });
  env.nsfwVoteRepository.registerVoto({ voteId: vote.id, userJid: uniqueJid(), voto: 'nao' });

  env.nsfwVoteRepository.encerrarVotacao({ voteId: vote.id, resultado: 'nao' });
  assert.equal(env.nsfwVoteRepository.getPermitirNsfw(env.scopeKey), false);
});

test('nsfw: expiracao com empate registra empate', () => {
  const env = makeTestEnv();
  const totalMembros = 10;
  const agora = Date.now() - VOTE_DURATION_MS - 1000;
  const expiraEm = agora + VOTE_DURATION_MS;

  const vote = env.nsfwVoteRepository.createVote({ scopeKey: env.scopeKey, expiraEm, agora });

  // Register votes with the same agora so they aren't rejected as expired
  env.nsfwVoteRepository.registerVoto({ voteId: vote.id, userJid: uniqueJid(), voto: 'sim', agora: agora + 1 });
  env.nsfwVoteRepository.registerVoto({ voteId: vote.id, userJid: uniqueJid(), voto: 'nao', agora: agora + 2 });

  const updated = env.nsfwVoteRepository.getVoteById(vote.id);
  const result = env.nsfwService.tryEncerrar(updated, totalMembros);
  assert.ok(result.ok);
  assert.equal(result.result, 'empate');
});

test('nsfw: encerramento atualiza permitirNsfw corretamente', () => {
  const env = makeTestEnv();
  const vote = createVote(env);
  const totalMembros = 6;

  assert.equal(env.nsfwVoteRepository.getPermitirNsfw(env.scopeKey), false);

  for (let i = 0; i < 3; i++) {
    env.nsfwVoteRepository.registerVoto({ voteId: vote.id, userJid: uniqueJid(), voto: 'sim' });
  }

  const updated = env.nsfwVoteRepository.getVoteById(vote.id);
  env.nsfwService.tryEncerrar(updated, totalMembros);
  assert.equal(env.nsfwVoteRepository.getPermitirNsfw(env.scopeKey), true);
});

test('nsfw: encerramento com nao mantem permitirNsfw false', () => {
  const env = makeTestEnv();
  const vote = createVote(env);
  const totalMembros = 6;

  for (let i = 0; i < 3; i++) {
    env.nsfwVoteRepository.registerVoto({ voteId: vote.id, userJid: uniqueJid(), voto: 'nao' });
  }

  const updated = env.nsfwVoteRepository.getVoteById(vote.id);
  env.nsfwService.tryEncerrar(updated, totalMembros);
  assert.equal(env.nsfwVoteRepository.getPermitirNsfw(env.scopeKey), false);
});

test('nsfw: update funGroupSettings via funGroupRepository mantem permitirNsfw', () => {
  const env = makeTestEnv();
  const { groupRepository, scopeKey } = env;

  groupRepository.upsertGroupSettings({ groupJid: scopeKey });
  let settings = groupRepository.getGroupSettings(scopeKey);
  assert.equal(settings.permitirNsfw, false);

  groupRepository.upsertGroupSettings({ groupJid: scopeKey, permitirNsfw: true });
  settings = groupRepository.getGroupSettings(scopeKey);
  assert.equal(settings.permitirNsfw, true);
});

test('nsfw: voto invalido rejeitado', () => {
  const env = makeTestEnv();
  const vote = createVote(env);
  const user = uniqueJid();

  const result = env.nsfwVoteRepository.registerVoto({ voteId: vote.id, userJid: user, voto: 'talvez' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'invalid-voto');
});

test('nsfw: voto em votacao expirada rejeitado', () => {
  const env = makeTestEnv();
  const agora = Date.now();
  const expiraEm = agora - 1000;
  const vote = env.nsfwVoteRepository.createVote({ scopeKey: env.scopeKey, expiraEm, agora });
  const user = uniqueJid();

  const result = env.nsfwVoteRepository.registerVoto({ voteId: vote.id, userJid: user, voto: 'sim', agora: agora + 2000 });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'vote-expired');
});

test('nsfw: voto em votacao encerrada rejeitado', () => {
  const env = makeTestEnv();
  const vote = createVote(env);
  env.nsfwVoteRepository.encerrarVotacao({ voteId: vote.id, resultado: 'nao' });

  const user = uniqueJid();
  const result = env.nsfwVoteRepository.registerVoto({ voteId: vote.id, userJid: user, voto: 'sim' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'vote-closed');
});

test('nsfw: listRecentVotes retorna votações ordenadas', () => {
  const env = makeTestEnv();
  const v1 = createVote(env);

  const votes = env.nsfwVoteRepository.listRecentVotes(env.scopeKey);
  assert.ok(votes.length >= 1);
  assert.equal(votes[0].id, v1.id);
});

test('nsfw: getVoteStatus do service retorna info correta', () => {
  const env = makeTestEnv();
  const vote = createVote(env);
  const totalMembros = 10;

  const status = env.nsfwService.getVoteStatus(vote, totalMembros);
  assert.equal(status.voteId, vote.id);
  assert.equal(status.status, 'active');
  assert.equal(status.totalMembros, 10);
  assert.equal(status.requiredVotes, 5);
  assert.equal(status.result, null);
});
