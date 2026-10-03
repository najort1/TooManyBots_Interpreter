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

  // Hunter assalta target com sucesso roubando 20 coins
  // Regra de proporcionalidade: recompensa limitada a min(160, 20 * 2 = 40 coins)
  const claimed = service.claimOnAssault({
    scopeKey,
    hunterJid: hunter,
    targetJid: target,
    stolenCoins: 20,
  });

  assert.equal(claimed.claimed, true);
  assert.equal(claimed.bountyId, created.bounty.id);
  assert.equal(claimed.rewardAmount, 40, 'Recompensa deve ser proporcional ao roubo real (40)');

  // Hunter recebe os 40 coins parciais do contrato
  const balHunter = statsRepo.getUserStats(hunter, scopeKey).coins;
  assert.equal(balHunter, 40);

  // Contrato permanece aberto com o saldo remanescente de 120 coins
  const b = bountyRepo.getBounty(created.bounty.id);
  assert.equal(b.status, 'open');
  assert.equal(b.bountyAmount, 120, 'Saldo remanescente de 120 coins continua aberto');

  // Segundo assalto rouba 80 coins e liquida o restante (120 coins)
  const claimed2 = service.claimOnAssault({
    scopeKey,
    hunterJid: hunter,
    targetJid: target,
    stolenCoins: 80,
  });
  assert.equal(claimed2.claimed, true);
  assert.equal(claimed2.rewardAmount, 120, 'Deve liquidar os 120 coins restantes');
  assert.equal(statsRepo.getUserStats(hunter, scopeKey).coins, 160);

  const bFinal = bountyRepo.getBounty(created.bounty.id);
  assert.equal(bFinal.status, 'claimed');
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

test('trialService: arquiva julgamento sem multa e devolve caução se réu estiver com imunidade judicial ativa', async () => {
  const statsRepo = createFunStatsRepository({ getDatabase: getDb });
  const trialRepo = createFunTrialRepository({ getDatabase: getDb });
  let hasImmunity = false;
  const mockEffects = {
    getEffect: (u, s, key) => (key === 'tribunal_immunity' && hasImmunity ? { active: true } : null),
    setTimedEffect: () => {},
  };

  const service = createTrialService({
    trialRepository: trialRepo,
    statsRepository: statsRepo,
    effectsRepository: mockEffects,
  });

  const scopeKey = uniqueGroup();
  const accuser = uniqueJid();
  const defendant = uniqueJid();
  const voter = uniqueJid();

  statsRepo.addCoins({ userJid: accuser, scopeKey, amount: 200, reason: 'seed' });
  statsRepo.addCoins({ userJid: defendant, scopeKey, amount: 100, reason: 'seed' });

  const startRes = service.openTrial({
    scopeKey,
    accuserJid: accuser,
    defendantJid: defendant,
    charge: 'Tentativa de golpe',
  });

  service.vote({ trialId: startRes.trial.id, voterJid: voter, vote: 'guilty' });

  // Réu ganha imunidade enquanto a votação acontecia
  hasImmunity = true;

  const resolveRes = service.resolveTrial(startRes.trial.id);
  assert.equal(resolveRes.status, 'dismissed');
  assert.equal(resolveRes.reason, 'defendant-immune');

  // Caução de 150 deve ter sido devolvida integralmente ao acusador (50 + 150 = 200)
  assert.equal(statsRepo.getUserStats(accuser, scopeKey).coins, 200);
  // Réu não sofre multa (mantém 100)
  assert.equal(statsRepo.getUserStats(defendant, scopeKey).coins, 100);
});

test('trialRepository: getTrial agrega votos ao vivo diretamente da tabela fun_trial_votes com suporte a pesos', async () => {
  const trialRepo = createFunTrialRepository({ getDatabase: getDb });
  const scopeKey = uniqueGroup();
  const accuser = uniqueJid();
  const defendant = uniqueJid();
  const juror1 = uniqueJid();
  const juror2 = uniqueJid();

  const trial = trialRepo.createTrial({
    scopeKey,
    accuserJid: accuser,
    defendantJid: defendant,
    infractionType: 'spam',
    evidenceSummary: 'Flood de figurinha',
    bailAmount: 150,
    durationMs: 90_000,
  });

  // Juror 1: voto culpado com peso reduzido (ex: cônjuge do acusador 0.3)
  trialRepo.castVote({ trialId: trial.id, voterJid: juror1, vote: 'guilty', voteWeight: 0.3 });
  // Juror 2: voto culpado padrão peso 1.0
  trialRepo.castVote({ trialId: trial.id, voterJid: juror2, vote: 'guilty', voteWeight: 1.0 });

  const liveTrial = trialRepo.getTrial(trial.id);
  assert.equal(liveTrial.guiltyVotes, 2, 'Contagem de votos culpados deve ser 2');
  assert.equal(liveTrial.innocentVotes, 0, 'Contagem de votos inocentes deve ser 0');
  assert.equal(liveTrial.guiltyWeighted, 1.3, 'Pontuação ponderada deve somar 1.3');
});

test('bountyService: suporta múltiplos contratos no mesmo alvo e impede double-claim', async () => {
  const statsRepo = createFunStatsRepository({ getDatabase: getDb });
  const bountyRepo = createFunBountyRepository({ getDatabase: getDb });
  const service = createBountyService({
    bountyRepository: bountyRepo,
    statsRepository: statsRepo,
  });

  const scopeKey = uniqueGroup();
  const issuer1 = uniqueJid();
  const issuer2 = uniqueJid();
  const target = uniqueJid();
  const hunter1 = uniqueJid();
  const hunter2 = uniqueJid();

  statsRepo.addCoins({ userJid: issuer1, scopeKey, amount: 500, reason: 'seed' });
  statsRepo.addCoins({ userJid: issuer2, scopeKey, amount: 500, reason: 'seed' });

  // Emite dois contratos de 100 coins contra o mesmo alvo
  service.createBounty({ scopeKey, issuerJid: issuer1, targetJid: target, amount: 100, reason: 'Bounty 1' });
  service.createBounty({ scopeKey, issuerJid: issuer2, targetJid: target, amount: 100, reason: 'Bounty 2' });

  // Caçador 1 assalta
  const claim1 = service.claimOnAssault({ scopeKey, hunterJid: hunter1, targetJid: target, stolenCoins: 50 });
  assert.equal(claim1.claimed, true, 'Caçador 1 deve liquidar primeiro contrato');

  // Caçador 2 assalta
  const claim2 = service.claimOnAssault({ scopeKey, hunterJid: hunter2, targetJid: target, stolenCoins: 40 });
  assert.equal(claim2.claimed, true, 'Caçador 2 deve liquidar segundo contrato');
  assert.notEqual(claim1.bountyId, claim2.bountyId, 'Os dois caçadores devem ter liquidado contratos distintos');

  // Terceiro assalto após esgotamento dos contratos
  const claim3 = service.claimOnAssault({ scopeKey, hunterJid: hunter1, targetJid: target, stolenCoins: 30 });
  assert.equal(claim3.claimed, false, 'Não deve haver mais contratos abertos');
  assert.equal(claim3.reason, 'no-active-bounty');
});

test('trialService: arquiva julgamento e estorna caução quando quórum for inferior a 2 jurados', () => {
  const statsRepo = createFunStatsRepository({ getDatabase: getDb });
  const trialRepo = createFunTrialRepository({ getDatabase: getDb });
  const service = createTrialService({
    trialRepository: trialRepo,
    statsRepository: statsRepo,
  });

  const scopeKey = uniqueGroup();
  const accuser = uniqueJid();
  const defendant = uniqueJid();
  const singleVoter = uniqueJid();

  statsRepo.addCoins({ userJid: accuser, scopeKey, amount: 200, reason: 'seed' });
  statsRepo.addCoins({ userJid: defendant, scopeKey, amount: 100, reason: 'seed' });

  const startRes = service.openTrial({
    scopeKey,
    accuserJid: accuser,
    defendantJid: defendant,
    charge: 'Processo na calada da noite',
  });

  // Apenas 1 voto computado (falta de quórum)
  service.vote({ trialId: startRes.trial.id, voterJid: singleVoter, vote: 'guilty' });

  const resolveRes = service.resolveTrial(startRes.trial.id);
  assert.equal(resolveRes.status, 'dismissed');
  assert.equal(resolveRes.reason, 'no-quorum');

  // Caução de 150 restituída ao acusador
  assert.equal(statsRepo.getUserStats(accuser, scopeKey).coins, 200);
  assert.equal(statsRepo.getUserStats(defendant, scopeKey).coins, 100);
});
