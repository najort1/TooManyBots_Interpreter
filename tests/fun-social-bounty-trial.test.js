import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import { createFunStatsRepository } from '../fun/db/funStatsRepository.js';
import { createFunRelationshipRepository } from '../fun/db/funRelationshipRepository.js';
import { createFunEffectsRepository } from '../fun/db/funEffectsRepository.js';
import { createFunBountyRepository } from '../fun/db/funBountyRepository.js';
import { createFunTrialRepository } from '../fun/db/funTrialRepository.js';
import { createBountyService } from '../fun/services/bountyService.js';
import { createTrialService } from '../fun/services/trialService.js';

await initDb();

function uniqueGroup() {
  return `120363${String(Date.now()).slice(-10)}${Math.floor(Math.random() * 90 + 10)}@g.us`;
}

let counter = 2000;
function uniqueJid() {
  counter += 1;
  return `551198${String(Date.now()).slice(-6)}${String(counter).padStart(4, '0')}@s.whatsapp.net`;
}

test('bountyService: cria contrato retendo taxa e bloqueia abusos (auto-bounty, cônjuge, saldo)', () => {
  const statsRepo = createFunStatsRepository({ getDatabase: getDb });
  const relRepo = createFunRelationshipRepository({ getDatabase: getDb });
  const bountyRepo = createFunBountyRepository({ getDatabase: getDb });
  const service = createBountyService({
    bountyRepository: bountyRepo,
    statsRepository: statsRepo,
    relationshipRepository: relRepo,
  });

  const scopeKey = uniqueGroup();
  const issuer = uniqueJid();
  const target = uniqueJid();

  // 1. Saldo insuficiente
  const r1 = service.createBounty({ scopeKey, issuerJid: issuer, targetJid: target, amount: 200 });
  assert.equal(r1.ok, false);
  assert.equal(r1.reason, 'insufficient-balance');

  // Adiciona saldo
  statsRepo.addCoins({ userJid: issuer, scopeKey, amount: 500, reason: 'seed' });

  // 2. Auto-bounty
  const r2 = service.createBounty({ scopeKey, issuerJid: issuer, targetJid: issuer, amount: 200 });
  assert.equal(r2.ok, false);
  assert.equal(r2.reason, 'self-target');

  // 3. Bounty em cônjuge
  relRepo.marry({ userJid: issuer, partnerJid: target, scopeKey });
  const r3 = service.createBounty({ scopeKey, issuerJid: issuer, targetJid: target, amount: 200 });
  assert.equal(r3.ok, false);
  assert.equal(r3.reason, 'spouse-target');

  // Desfaz casamento e cria contrato válido
  relRepo.divorce({ userJid: issuer, scopeKey });
  const r4 = service.createBounty({
    scopeKey,
    issuerJid: issuer,
    targetJid: target,
    amount: 200,
    reason: 'Me roubou ontem!',
  });

  assert.equal(r4.ok, true);
  assert.ok(r4.bounty.id);
  // Recompensa líquida de 80% (160 coins) com 20% retidos na taxa do submundo
  assert.equal(r4.bounty.bountyAmount, 160);

  // O saldo de quem contratou foi debitado em 200
  const balIssuer = statsRepo.getUserStats(issuer, scopeKey).coins;
  assert.equal(balIssuer, 300);
});

test('bountyService: liquida recompensa para caçador após assalto bem-sucedido', () => {
  const statsRepo = createFunStatsRepository({ getDatabase: getDb });
  const bountyRepo = createFunBountyRepository({ getDatabase: getDb });
  const service = createBountyService({
    bountyRepository: bountyRepo,
    statsRepository: statsRepo,
  });

  const scopeKey = uniqueGroup();
  const issuer = uniqueJid();
  const target = uniqueJid();
  const hunter = uniqueJid();

  statsRepo.addCoins({ userJid: issuer, scopeKey, amount: 500, reason: 'seed' });
  const created = service.createBounty({ scopeKey, issuerJid: issuer, targetJid: target, amount: 200 });

  // Hunter assalta target com sucesso
  const claimed = service.claimOnAssault({
    scopeKey,
    hunterJid: hunter,
    targetJid: target,
    stolenCoins: 20,
  });

  assert.equal(claimed.claimed, true);
  assert.equal(claimed.bountyId, created.bounty.id);
  assert.equal(claimed.rewardAmount, 160);

  // Hunter recebe os 160 coins do contrato
  const balHunter = statsRepo.getUserStats(hunter, scopeKey).coins;
  assert.equal(balHunter, 160);

  // Contrato fica marcado como resgatado (claimed)
  const b = bountyRepo.getBounty(created.bounty.id);
  assert.equal(b.status, 'claimed');
  assert.equal(b.claimedByJid, hunter);
});

test('trialService: abre julgamento com caução e condena réu com voto da maioria', () => {
  const statsRepo = createFunStatsRepository({ getDatabase: getDb });
  const effectsRepo = createFunEffectsRepository({ getDatabase: getDb });
  const trialRepo = createFunTrialRepository({ getDatabase: getDb });
  const service = createTrialService({
    trialRepository: trialRepo,
    statsRepository: statsRepo,
    effectsRepository: effectsRepo,
  });

  const scopeKey = uniqueGroup();
  const accuser = uniqueJid();
  const defendant = uniqueJid();
  const voter1 = uniqueJid();
  const voter2 = uniqueJid();
  const voter3 = uniqueJid();

  // Dá moedas para o acusador (caução 150) e réu (300)
  statsRepo.addCoins({ userJid: accuser, scopeKey, amount: 300, reason: 'seed' });
  statsRepo.addCoins({ userJid: defendant, scopeKey, amount: 300, reason: 'seed' });

  // 1. Abre o tribunal
  const startRes = service.openTrial({
    scopeKey,
    accuserJid: accuser,
    defendantJid: defendant,
    charge: 'Roubou o cofre da facção!',
  });

  assert.equal(startRes.ok, true);
  assert.equal(statsRepo.getUserStats(accuser, scopeKey).coins, 150, 'Caução de 150 foi debitada');

  // 2. Votação
  service.vote({ trialId: startRes.trial.id, voterJid: voter1, vote: 'guilty' });
  service.vote({ trialId: startRes.trial.id, voterJid: voter2, vote: 'guilty' });
  service.vote({ trialId: startRes.trial.id, voterJid: voter3, vote: 'innocent' });

  // 3. Resolução
  const resolveRes = service.resolveTrial(startRes.trial.id);
  assert.equal(resolveRes.status, 'convicted');

  // Réu perdeu multa (10% de 300 = 30 coins)
  assert.equal(statsRepo.getUserStats(defendant, scopeKey).coins, 270);

  // Acusador recuperou a caução (150) + bônus da multa (30) = 150 + 180 = 330
  assert.equal(statsRepo.getUserStats(accuser, scopeKey).coins, 330);

  // Réu recebe efeito de condenado público e imunidade de tribunal
  assert.ok(effectsRepo.getEffect(defendant, scopeKey, 'condenado_publico'));
  assert.ok(effectsRepo.getEffect(defendant, scopeKey, 'tribunal_immunity'));
});

test('trialService: inocenta réu e transfere caução por litigância de má-fé se votos inocentes vencerem', () => {
  const statsRepo = createFunStatsRepository({ getDatabase: getDb });
  const trialRepo = createFunTrialRepository({ getDatabase: getDb });
  const service = createTrialService({
    trialRepository: trialRepo,
    statsRepository: statsRepo,
  });

  const scopeKey = uniqueGroup();
  const accuser = uniqueJid();
  const defendant = uniqueJid();
  const voter1 = uniqueJid();
  const voter2 = uniqueJid();

  statsRepo.addCoins({ userJid: accuser, scopeKey, amount: 200, reason: 'seed' });
  statsRepo.addCoins({ userJid: defendant, scopeKey, amount: 100, reason: 'seed' });

  const startRes = service.openTrial({
    scopeKey,
    accuserJid: accuser,
    defendantJid: defendant,
    charge: 'Acusação falsa!',
  });

  // Votação pró-inocente
  service.vote({ trialId: startRes.trial.id, voterJid: voter1, vote: 'innocent' });
  service.vote({ trialId: startRes.trial.id, voterJid: voter2, vote: 'innocent' });

  const resolveRes = service.resolveTrial(startRes.trial.id);
  assert.equal(resolveRes.status, 'acquitted');

  // Réu foi indenizado com os 150 coins da caução do acusador! (100 + 150 = 250)
  assert.equal(statsRepo.getUserStats(defendant, scopeKey).coins, 250);
  assert.equal(statsRepo.getUserStats(accuser, scopeKey).coins, 50);
});
