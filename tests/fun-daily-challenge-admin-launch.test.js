import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { createFunModule } from '../fun/index.js';
import { createFunDailyChallengeRepository } from '../fun/db/funDailyChallengeRepository.js';

await initDb();

function uniqueGroup(suffix = '') {
  return `120363${Date.now()}${Math.floor(Math.random() * 1000)}${suffix}@g.us`;
}

function createHarness({ groups, failJid = '' } = {}) {
  const repository = createFunDailyChallengeRepository();
  const calls = [];
  const service = {
    async processExpired({ scopeKey, now }) {
      const active = repository.getActiveChallenge(scopeKey);
      if (active) repository.expireChallenge(active.id, now);
      return { ok: Boolean(active) };
    },
    async launchChallenge({ scopeKey, type, now, sendText }) {
      if (scopeKey === failJid) throw new Error('grupo-indisponivel');
      const id = repository.createChallenge({
        scopeKey,
        type,
        data: { test: true },
        answer: 'resposta',
        launchedAt: now,
        expiresAt: now + 3600000,
        dateStr: '2099-01-01',
      });
      await sendText(scopeKey, 'desafio');
      calls.push(scopeKey);
      return { ok: true, challenge: { id, type, challengeType: type } };
    },
  };
  const module = createFunModule({
    getConfig: () => ({ enabled: true, dailyChallengeEnabled: true, groupWhitelistJids: groups }),
    dailyChallengeRepository: repository,
    dailyChallengeService: service,
    getSock: () => ({ user: { id: 'bot@s.whatsapp.net' } }),
    sendText: async () => {},
    sendImage: async () => {},
  });
  return { module, repository, calls };
}

test('admin daily challenge: tipo inválido não escreve', async () => {
  const group = uniqueGroup('1');
  const { module, repository, calls } = createHarness({ groups: [group] });
  const result = await module.launchDailyChallengeForWhitelist({ type: 'invalid' });
  assert.deepEqual(result, { ok: false, reason: 'invalid-type' });
  assert.equal(repository.getActiveChallenge(group), null);
  assert.equal(calls.length, 0);
});

test('admin daily challenge: whitelist vazia retorna no-groups', async () => {
  const { module } = createHarness({ groups: [] });
  assert.deepEqual(
    await module.launchDailyChallengeForWhitelist({ type: 'riddle' }),
    { ok: false, reason: 'no-groups' }
  );
});

test('admin daily challenge: substitui ativo e lança texto apenas nos grupos @g.us', async () => {
  const groupA = uniqueGroup('2');
  const groupB = uniqueGroup('3');
  const nonGroup = `5511${Date.now()}@s.whatsapp.net`;
  const { module, repository, calls } = createHarness({ groups: [groupA, nonGroup, groupB] });
  const oldId = repository.createChallenge({
    scopeKey: groupA,
    type: 'riddle',
    data: {},
    answer: 'antigo',
    launchedAt: 1,
    expiresAt: Date.now() + 3600000,
    dateStr: '2000-01-01',
  });

  const result = await module.launchDailyChallengeForWhitelist({ type: 'guess_game', now: 1000 });
  assert.equal(result.ok, true);
  assert.equal(result.targetCount, 2);
  assert.equal(result.okCount, 2);
  assert.deepEqual(calls, [groupA, groupB]);
  assert.equal(repository.getActiveChallenge(groupA).challengeType, 'guess_game');
  assert.equal(repository.getActiveChallenge(groupB).challengeType, 'guess_game');
  assert.equal(result.results.find((row) => row.jid === groupA).replacedChallengeId, oldId);
});

test('admin daily challenge: falha em um grupo não interrompe os demais', async () => {
  const groupA = uniqueGroup('4');
  const groupB = uniqueGroup('5');
  const { module, repository, calls } = createHarness({ groups: [groupA, groupB], failJid: groupA });
  const result = await module.launchDailyChallengeForWhitelist({ type: 'riddle' });
  assert.equal(result.ok, false);
  assert.equal(result.okCount, 1);
  assert.equal(result.failCount, 1);
  assert.equal(result.results.find((row) => row.jid === groupA).reason, 'grupo-indisponivel');
  assert.deepEqual(calls, [groupB]);
  assert.equal(repository.getActiveChallenge(groupB).challengeType, 'riddle');
});
