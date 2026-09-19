/**
 * Testes unitários do módulo de Bombeiros (TooManyBots Fun).
 * Valida o motor físico de combate a incêndio, termodinâmica, resgate de vítimas,
 * escalada de dificuldade, sistema de pontuação e integração com a economia.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FirefighterEngine,
  DURATION_LIMITS,
  FIRE_CLASSES,
  NOZZLE_MODES,
  NOZZLE_SPECS,
  TANK_SPECS,
  normalizeDurationMs,
  getProgressionState,
  calculateFirefighterScore,
  getRankForScore,
  validateFirefighterAttempt,
  calculateFirefighterRewards,
  applyFirefighterRewards,
} from '../fun/firefighters/index.js';
import { createFunStatsRepository } from '../fun/db/funStatsRepository.js';
import { createFunJobRepository } from '../fun/db/funJobRepository.js';
import { createJobService } from '../fun/services/jobService.js';
import { resolveFunConfig } from '../fun/config.js';
import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';

await initDb();

function uniqueJid(prefix = '5511') {
  return `${prefix}${Date.now()}${Math.floor(Math.random() * 100000)}@s.whatsapp.net`;
}

function uniqueGroup() {
  return `120363000${Date.now()}${Math.floor(Math.random() * 10000)}@g.us`;
}

test('firefighters: normalização e limites de duração da partida', () => {
  // Limites: mínimo 60s (1 min), máximo 300s (5 min), padrão 90s
  assert.equal(normalizeDurationMs(), DURATION_LIMITS.DEFAULT_MS);
  assert.equal(normalizeDurationMs(null), 90_000);
  assert.equal(normalizeDurationMs(30_000), 60_000); // Clamped ao mínimo de 1 minuto
  assert.equal(normalizeDurationMs(120_000), 120_000);
  assert.equal(normalizeDurationMs(600_000), 300_000); // Clamped ao máximo de 5 minutos
});

test('firefighters: curva de progressão de dificuldade em 3 fases', () => {
  const total = 90_000;

  // Fase 1: 0% a 33% (Alerta Inicial)
  const p1 = getProgressionState(10_000, total);
  assert.equal(p1.phaseId, 1);
  assert.equal(p1.phaseConfig.name, 'Alerta Inicial');

  // Fase 2: 33% a 66% (Alarme Geral)
  const p2 = getProgressionState(45_000, total);
  assert.equal(p2.phaseId, 2);
  assert.equal(p2.phaseConfig.name, 'Alarme Geral');

  // Fase 3: 66% a 100% (Ponto Crítico)
  const p3 = getProgressionState(75_000, total);
  assert.equal(p3.phaseId, 3);
  assert.equal(p3.phaseConfig.name, 'Ponto Crítico');
});

test('firefighters: combate tático - eficácia por classe de incêndio', () => {
  const engine = new FirefighterEngine({ durationMs: 90_000 });

  // 1. Combate Classe A com Jato de Água (Eficaz)
  const bldgA = engine.buildings.find((b) => b.fireClass === FIRE_CLASSES.A);
  assert.ok(bldgA, 'Edifício Classe A deve existir');
  engine.targetBuilding(bldgA.id);
  engine.selectNozzle(NOZZLE_MODES.WATER_JET);
  engine.startSpraying();

  const initialFlameA = bldgA.flameLevel;
  engine.update(1.0); // 1 segundo de spray
  engine.stopSpraying();

  assert.ok(
    bldgA.flameLevel < initialFlameA,
    'Jato de água deve reduzir chamas em incêndio Classe A'
  );
  assert.ok(engine.waterUsedLiters > 0, 'Água deve ter sido consumida');

  // 2. Combate Classe B com Água vs Espuma
  const bldgB = engine.buildings.find((b) => b.fireClass === FIRE_CLASSES.B);
  assert.ok(bldgB, 'Edifício Classe B deve existir');
  engine.targetBuilding(bldgB.id);

  // Erro tático: Água em combustível/química espalha chamas
  engine.selectNozzle(NOZZLE_MODES.WATER_JET);
  engine.startSpraying();
  const initialFlameB = bldgB.flameLevel;
  engine.update(1.0);
  engine.stopSpraying();
  assert.ok(
    bldgB.flameLevel > initialFlameB,
    'Água direta em incêndio químico Classe B deve espalhar chamas (penalidade)'
  );

  // Solução tática correta: Espuma (AFFF)
  engine.selectNozzle(NOZZLE_MODES.FOAM);
  engine.startSpraying();
  const flameBeforeFoam = bldgB.flameLevel;
  engine.update(2.0);
  engine.stopSpraying();
  assert.ok(
    bldgB.flameLevel < flameBeforeFoam,
    'Espuma deve suprimir com eficácia o incêndio químico Classe B'
  );
  assert.ok(engine.foamUsedLiters > 0, 'Espuma deve ter sido consumida');
});

test('firefighters: combate Classe C - segurança elétrica', () => {
  const engine = new FirefighterEngine({ durationMs: 90_000 });
  const bldgC = engine.buildings.find((b) => b.fireClass === FIRE_CLASSES.C);
  assert.ok(bldgC, 'Subestação Classe C deve existir');

  engine.targetBuilding(bldgC.id);

  // Erro tático: Jato direto conduz alta tensão e danifica integridade
  engine.selectNozzle(NOZZLE_MODES.WATER_JET);
  engine.startSpraying();
  const initIntegrity = bldgC.integrity;
  engine.update(1.0);
  engine.stopSpraying();
  assert.ok(
    bldgC.integrity < initIntegrity,
    'Jato direto em equipamento elétrico deve causar choque/curto e danificar integridade'
  );

  // Acerto tático: Neblina (Mist) resfria sem condução elétrica perigosa
  engine.selectNozzle(NOZZLE_MODES.MIST);
  engine.startSpraying();
  const flameBeforeMist = bldgC.flameLevel;
  engine.update(2.0);
  engine.stopSpraying();
  assert.ok(
    bldgC.flameLevel < flameBeforeMist,
    'Neblina deve conter fogo elétrico com segurança'
  );
});

test('firefighters: gestão de recursos e conexão com hidrante de rua', () => {
  const engine = new FirefighterEngine({ durationMs: 90_000 });
  engine.selectNozzle(NOZZLE_MODES.WATER_JET);
  engine.startSpraying();

  // Simula tanque completamente vazio
  engine.waterLiters = 0;
  engine.update(1.0);
  assert.equal(engine.waterLiters, 0, 'Não deve disparar com tanque de água vazio');

  // Conecta ao hidrante de rua
  assert.equal(engine.isHydrantConnected, false);
  engine.toggleHydrant(true);
  assert.equal(engine.isHydrantConnected, true);

  // Atualiza 2 segundos com hidrante ligado (+ 45L/s = +90L)
  engine.stopSpraying();
  engine.update(2.0);
  assert.ok(engine.waterLiters >= 80, 'Hidrante deve recarregar tanque continuamente');
  assert.ok(
    engine.waterLiters <= TANK_SPECS.WATER_MAX_LITERS,
    'Recarga não pode ultrapassar capacidade máxima do caminhão'
  );
});

test('firefighters: resgate de vítimas com escada Magirus telescópica', () => {
  const engine = new FirefighterEngine({ durationMs: 90_000 });
  const bldg = engine.buildings.find((b) => b.victimsTrapped > 0);
  assert.ok(bldg, 'Deve haver edifício com vítimas presas');

  engine.targetBuilding(bldg.id);
  engine.setLadder(true);

  const initialSaved = engine.victimsSaved;
  const initialTrapped = bldg.victimsTrapped;

  // Atualiza por 5 segundos (tempo suficiente para 1 resgate completo de 4.5s)
  engine.update(5.0);

  assert.equal(
    engine.victimsSaved,
    initialSaved + 1,
    'Uma vítima deve ter sido salva pela escada telescópica'
  );
  assert.equal(
    bldg.victimsTrapped,
    initialTrapped - 1,
    'Vítima presa deve ter sido decrementada do edifício'
  );
});

test('firefighters: colapso estrutural e invariante lostHouses === buildingsCollapsed', () => {
  const engine = new FirefighterEngine({ durationMs: 90_000 });
  const bldg = engine.buildings[0];

  // Força queima severa e contínua sem combate
  bldg.flameLevel = 100;
  bldg.integrity = 5; // Quase colapsando

  engine.update(2.0); // Chamas destroem integridade restante

  assert.equal(bldg.isCollapsed, true, 'Edifício deve ter colapsado');
  assert.equal(engine.buildingsCollapsed, 1, 'Contador de colapsos deve ser 1');

  const metrics = engine.getMetrics();
  assert.equal(metrics.buildingsCollapsed, 1);
  assert.equal(metrics.lostHouses, 1);
  assert.equal(
    metrics.lostHouses,
    metrics.buildingsCollapsed,
    'lostHouses deve ser identicamente igual a buildingsCollapsed'
  );
});

test('firefighters: cálculo de pontuação, patentes e validação de tentativa', () => {
  // Cenário 1: Desempenho aprovado
  const goodMetrics = {
    firesExtinguished: 22,
    victimsSaved: 3,
    victimsLost: 0,
    buildingsSaved: 4,
    buildingsCollapsed: 1,
    lostHouses: 1,
    maxCombo: 5,
  };
  const score = calculateFirefighterScore(goodMetrics);
  assert.ok(score >= 20, `Pontuação deve ser suficiente para aprovação (score: ${score})`);

  const rank = getRankForScore(score);
  assert.ok(rank.title, 'Deve retornar título da patente');

  const validation = validateFirefighterAttempt({
    score,
    metrics: goodMetrics,
    config: { targetScore: 20, maxLostHouses: 3 },
  });
  assert.equal(validation.passed, true);

  // Cenário 2: Desastre (muitos colapsos)
  const badMetrics = {
    ...goodMetrics,
    buildingsCollapsed: 4,
    lostHouses: 4,
  };
  const badValidation = validateFirefighterAttempt({
    score: 30,
    metrics: badMetrics,
    config: { targetScore: 20, maxLostHouses: 3 },
  });
  assert.equal(badValidation.passed, false);
  assert.match(badValidation.reason, /Desabamentos excessivos/);

  // Cenário 3: Pontuação insuficiente
  const lowScoreValidation = validateFirefighterAttempt({
    score: 15,
    metrics: { lostHouses: 0 },
    config: { targetScore: 20, maxLostHouses: 3 },
  });
  assert.equal(lowScoreValidation.passed, false);
  assert.match(lowScoreValidation.reason, /Pontuação insuficiente/);
});

test('firefighters: cálculo de recompensas e premiação na economia', () => {
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();

  const userJid = uniqueJid('5519');
  const scopeKey = uniqueGroup();

  const rewards = calculateFirefighterRewards({
    score: 45,
    metrics: { firesExtinguished: 10, victimsSaved: 2 },
  });

  assert.ok(rewards.xp >= 20, 'Deve conceder XP condizente');
  assert.ok(rewards.coins >= 25, 'Deve conceder moedas condizentes');
  assert.ok(rewards.rank.title, 'Deve possuir patente');
  assert.match(rewards.message, /Corpo de Bombeiros/);

  // Aplicação das recompensas
  const applied = applyFirefighterRewards({
    repository: repo,
    userJid,
    scopeKey,
    rewards,
  });

  assert.equal(applied.success, true);
  assert.equal(applied.coinsAwarded, rewards.coins);
  assert.equal(applied.xpAwarded, rewards.xp);

  const stats = repo.getUserStats(userJid, scopeKey);
  assert.equal(stats.coins, rewards.coins);
  assert.equal(stats.xp, rewards.xp);
});

test('firefighters: integração ponta a ponta com jobService (aprovação e contratação)', () => {
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const jobRepo = createFunJobRepository({ getDatabase: getDb });
  const jobService = createJobService({ repository: repo, jobRepository: jobRepo });

  const userJid = uniqueJid('5521');
  const scopeKey = uniqueGroup();
  const cfg = resolveFunConfig({
    publicBaseUrl: 'https://test.local',
    jobTokenSecret: 'secret-firefighter-e2e',
  });

  // 1. Inicia candidatura ao cargo de Bombeiro
  const app = jobService.startApplication({
    userJid,
    scopeKey,
    jobId: 'bombeiro',
    funConfig: cfg,
  });
  assert.equal(app.ok, true);

  // 2. Finaliza com sucesso
  const result = jobService.finishAttempt({
    attemptId: app.attempt.id,
    token: app.token,
    score: 35,
    durationMs: 89_000,
    metrics: {
      firesExtinguished: 22,
      victimsSaved: 3,
      buildingsSaved: 4,
      buildingsCollapsed: 1,
      lostHouses: 1,
      maxCombo: 6,
    },
    funConfig: cfg,
  });

  assert.equal(result.ok, true);
  assert.equal(result.passed, true);
  assert.equal(result.job.id, 'bombeiro');
  assert.ok(result.rewards, 'Deve incluir recompensas de bombeiro no retorno');
  assert.ok(result.rewards.coins > 0);
  assert.ok(result.rewards.xp > 0);

  // 3. Usuário agora está empregado como Bombeiro
  const userJob = jobRepo.getUserJob(userJid, scopeKey);
  assert.equal(userJob?.jobId, 'bombeiro');

  // 4. Saldo do usuário recebeu as gratificações
  const stats = repo.getUserStats(userJid, scopeKey);
  assert.equal(stats.coins, result.rewards.coins);
  assert.equal(stats.xp, result.rewards.xp);
});
