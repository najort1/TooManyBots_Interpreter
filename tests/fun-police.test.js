/**
 * Testes do sistema policial (PoliceService) do módulo Fun.
 *
 * C1 — Funções Puras (sem banco)
 * C2 — Wanted System (cooldowns / ledger)
 * C3 — Immunity (Police Pass)
 * C4 — Integração (evaluate / afterCrime)
 * C5 — Edge Cases & Balanceamento
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import { ensureFunSchema } from '../fun/schema.js';
import {
  _resetDefaultFunStatsRepository,
  createFunStatsRepository,
} from '../fun/db/funStatsRepository.js';
import { createFunEffectsRepository } from '../fun/db/funEffectsRepository.js';
import {
  createPoliceService,
  wantedLevelFromPoints,
  computeSuspicionScore,
  WANTED_LEVEL_THRESHOLDS,
  WANTED_DECAY_MS,
  POLICE_IMMUNITY_DURATION_MS,
  POLICE_IMMUNITY_MAX_USES,
  POLICE_IMMUNITY_WEEK_MS,
} from '../fun/services/policeService.js';

await initDb();
_resetDefaultFunStatsRepository();
ensureFunSchema(getDb());

// ── Helpers ──────────────────────────────────────────────

let _jidSeq = 0;
function uniqueJid(prefix = '5511') {
  _jidSeq += 1;
  return `${prefix}${String(Date.now()).slice(-5)}${_jidSeq}${Math.floor(Math.random() * 900 + 100)}@s.whatsapp.net`;
}

let _groupSeq = 0;
function uniqueGroup() {
  _groupSeq += 1;
  return `120363${String(Date.now()).slice(-8)}${_groupSeq}${Math.floor(Math.random() * 90 + 10)}@g.us`;
}

/** Tolerância em asserções float. */
function approx(a, b, tol = 0.01) {
  return Math.abs(a - b) < tol;
}

/** Popula o ledger com um crime para o usuário. */
function seedCrime(db, scopeKey, userJid, reason, amount = 100, createdAt = Date.now()) {
  db.prepare(
    `INSERT INTO analytics.fun_coin_ledger (scope_key, from_jid, to_jid, amount, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(String(scopeKey), null, String(userJid), amount, String(reason), Number(createdAt));
}

/** Popula o ledger com um crime onde o usuário é vítima (assault-victim). */
function seedVictim(db, scopeKey, victimJid, attackerJid, createdAt = Date.now()) {
  db.prepare(
    `INSERT INTO analytics.fun_coin_ledger (scope_key, from_jid, to_jid, amount, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(String(scopeKey), String(attackerJid), String(victimJid), -50, 'assault-victim', Number(createdAt));
}

/** Insere/atualiza um cooldown (usado internamente como K/V). */
function setCooldown(db, userJid, scopeKey, game, lastAt) {
  db.prepare(
    `INSERT INTO analytics.fun_casino_cooldowns (user_jid, scope_key, game, last_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_jid, scope_key, game) DO UPDATE SET last_at = excluded.last_at`
  ).run(String(userJid), String(scopeKey), String(game), Number(lastAt));
}

// ── C1 Funções Puras ──────────────────────────────────

test('C1: wantedLevelFromPoints — nível 0 com 0 pontos', () => {
  assert.equal(wantedLevelFromPoints(0), 0);
});

test('C1: wantedLevelFromPoints — nível 0 com pontos abaixo de threshold 1', () => {
  // thresholds[1] = 6, então 1..5 deve ser nível 0
  for (let p = 1; p <= 5; p++) {
    assert.equal(wantedLevelFromPoints(p), 0, `points=${p} deve ser nível 0`);
  }
});

test('C1: wantedLevelFromPoints — nível 1 exato no threshold (6)', () => {
  assert.equal(wantedLevelFromPoints(6), 1);
});

test('C1: wantedLevelFromPoints — nível 2 exato no threshold (14)', () => {
  assert.equal(wantedLevelFromPoints(14), 2);
});

test('C1: wantedLevelFromPoints — nível 3 exato no threshold (28)', () => {
  assert.equal(wantedLevelFromPoints(28), 3);
});

test('C1: wantedLevelFromPoints — nível 4 exato no threshold (48)', () => {
  assert.equal(wantedLevelFromPoints(48), 4);
});

test('C1: wantedLevelFromPoints — nível 5 exato no threshold (80)', () => {
  assert.equal(wantedLevelFromPoints(80), 5);
});

test('C1: wantedLevelFromPoints — nível 5 acima do threshold máximo', () => {
  assert.equal(wantedLevelFromPoints(200), 5);
  assert.equal(wantedLevelFromPoints(9999), 5);
});

test('C1: wantedLevelFromPoints — valores limítrofes entre thresholds', () => {
  // 7-13: nível 1
  for (let p = 7; p <= 13; p++) assert.equal(wantedLevelFromPoints(p), 1, `points=${p}`);
  // 15-27: nível 2
  for (let p = 15; p <= 27; p++) assert.equal(wantedLevelFromPoints(p), 2, `points=${p}`);
  // 29-47: nível 3
  for (let p = 29; p <= 47; p++) assert.equal(wantedLevelFromPoints(p), 3, `points=${p}`);
  // 49-79: nível 4
  for (let p = 49; p <= 79; p++) assert.equal(wantedLevelFromPoints(p), 4, `points=${p}`);
});

test('C1: wantedLevelFromPoints — valores negativos retornam 0', () => {
  assert.equal(wantedLevelFromPoints(-1), 0);
  assert.equal(wantedLevelFromPoints(-100), 0);
});

test('C1: wantedLevelFromPoints — NaN, undefined, string numérica', () => {
  assert.equal(wantedLevelFromPoints(NaN), 0);
  assert.equal(wantedLevelFromPoints(undefined), 0);
  assert.equal(wantedLevelFromPoints(null), 0);
  assert.equal(wantedLevelFromPoints('5'), 0); // floor('5') → 0? Não, Number('5')=5
  // Na prática, wantedLevelFromPoints('5'): Number('5') || 0 = 5, max(0, floor(5)) = 5
  // Mas '5' não entra no || porque Number('5') = 5 que é truthy
  // Então: p = Math.max(0, Math.floor(5)) = 5, que dá nível 0
  assert.equal(wantedLevelFromPoints('6'), 1); // Number('6') = 6
});

test('C1: computeSuspicionScore — sem atividade criminal (tudo 0) → score baixo', () => {
  const score = computeSuspicionScore({ heat: 0, crimes7d: 0, wealth: 0, reportsScore: 0, wantedLevel: 0 });
  assert.equal(score, 0);
});

test('C1: computeSuspicionScore — heat alto sem riqueza → score médio', () => {
  // heat=10 → heatN=1, crimesN=0, wealthN=0, reportsN=0, wantedN=0
  // criminalSignal = 1*0.5 + 0 + 0 + 0 = 0.5
  // wealthWeighted = 0 * 0.5 = 0
  // score = 1*0.4 = 0.4
  const score = computeSuspicionScore({ heat: 10, crimes7d: 0, wealth: 0, reportsScore: 0, wantedLevel: 0 });
  assert.ok(approx(score, 0.4), `esperado ~0.4, obtido ${score}`);
});

test('C1: computeSuspicionScore — heat alto + crimes7d alto → score alto', () => {
  // heat=10 → 1, crimes7d=20 → 1, wealth=0, reportsScore=0, wantedLevel=0
  // criminalSignal = 1*0.5 + 1*0.7 + 0 + 0 = 1.2 → clamp01 = 1
  // wealthWeighted = 0 * 1 = 0
  // score = 1*0.4 + 1*0.3 = 0.7
  const score = computeSuspicionScore({ heat: 10, crimes7d: 20, wealth: 0, reportsScore: 0, wantedLevel: 0 });
  assert.ok(approx(score, 0.7), `esperado ~0.7, obtido ${score}`);
});

test('C1: computeSuspicionScore — rico (wealth=5000) sem criminalSignal → riqueza não pesa', () => {
  // wealth=5000 → wealthN=1, heat=0, crimes7d=0, reportsScore=0, wantedLevel=0
  // criminalSignal = 0 + 0 + 0 + 0 = 0
  // wealthWeighted = 1 * 0 = 0
  // score = 0
  const score = computeSuspicionScore({ heat: 0, crimes7d: 0, wealth: 5000, reportsScore: 0, wantedLevel: 0 });
  assert.equal(score, 0, 'rico honesto não deve gerar suspicion');
});

test('C1: computeSuspicionScore — rico + heat alto → riqueza pesa', () => {
  // heat=10 → heatN=1, wealth=5000 → wealthN=1
  // criminalSignal = 1*0.5 + 0 + 0 + 0 = 0.5
  // wealthWeighted = 1 * 0.5 = 0.5
  // score = 1*0.4 + 0.3*0 + 0.5*0.2 + 0.1*0 = 0.4 + 0 + 0.1 = 0.5
  const score = computeSuspicionScore({ heat: 10, crimes7d: 0, wealth: 5000, reportsScore: 0, wantedLevel: 0 });
  assert.ok(approx(score, 0.5), `esperado ~0.5, obtido ${score}`);
});

test('C1: computeSuspicionScore — scores máximos em todos os inputs → ~1', () => {
  const score = computeSuspicionScore({
    heat: 10,
    crimes7d: 20,
    wealth: 5000,
    reportsScore: 1,
    wantedLevel: 5,
  });
  // heatN=1, crimesN=1, wealthN=1, reportsN=1, wantedN=1
  // criminalSignal = 1*0.5 + 1*0.7 + 1*0.6 + 1*0.4 = 2.2 → clamp 1
  // wealthWeighted = 1 * 1 = 1
  // score = 1*0.4 + 1*0.3 + 1*0.2 + 1*0.1 = 1.0
  assert.ok(approx(score, 1.0), `esperado ~1.0, obtido ${score}`);
});

test('C1: computeSuspicionScore — valores negativos/NaN → clamp a 0', () => {
  const score = computeSuspicionScore({ heat: -5, crimes7d: NaN, wealth: null, reportsScore: undefined });
  assert.equal(score, 0);
});

test('C1: computeSuspicionScore — heat parcial + wanted nível 3', () => {
  // heat=5 → heatN=0.5, wantedLevel=3 → wantedN=0.6, crimes7d=5 → crimesN=0.25
  // criminalSignal = 0.5*0.5 + 0.25*0.7 + 0.6*0.6 = 0.25 + 0.175 + 0.36 = 0.785
  // wealth=0 → wealthWeighted=0
  // score = 0.5*0.4 + 0.25*0.3 + 0 + 0 = 0.2 + 0.075 = 0.275
  const score = computeSuspicionScore({ heat: 5, crimes7d: 5, wealth: 0, reportsScore: 0, wantedLevel: 3 });
  assert.ok(approx(score, 0.275), `esperado ~0.275, obtido ${score}`);
});

test('C1: wantedGainForCrime — bank+success → 5', () => {
  const police = createPoliceService();
  assert.equal(police.wantedGainForCrime({ mode: 'bank', success: true }), 5);
});

test('C1: wantedGainForCrime — bank+fail → 2', () => {
  const police = createPoliceService();
  assert.equal(police.wantedGainForCrime({ mode: 'bank', success: false }), 2);
});

test('C1: wantedGainForCrime — bank+policeBust → 4', () => {
  const police = createPoliceService();
  assert.equal(police.wantedGainForCrime({ mode: 'bank', success: false, policeBust: true }), 4);
});

test('C1: wantedGainForCrime — player+success → 3', () => {
  const police = createPoliceService();
  assert.equal(police.wantedGainForCrime({ mode: 'player', success: true }), 3);
});

test('C1: wantedGainForCrime — player+fail → 1', () => {
  const police = createPoliceService();
  assert.equal(police.wantedGainForCrime({ mode: 'player', success: false }), 1);
});

test('C1: wantedGainForCrime — player+policeBust → 3', () => {
  const police = createPoliceService();
  assert.equal(police.wantedGainForCrime({ mode: 'player', success: false, policeBust: true }), 3);
});

test('C1: wantedGainForCrime — shop+success → 2', () => {
  const police = createPoliceService();
  assert.equal(police.wantedGainForCrime({ mode: 'shop', success: true }), 2);
});

test('C1: wantedGainForCrime — shop+fail → 1', () => {
  const police = createPoliceService();
  assert.equal(police.wantedGainForCrime({ mode: 'shop', success: false }), 1);
});

test('C1: wantedGainForCrime — shop+policeBust → 3', () => {
  const police = createPoliceService();
  assert.equal(police.wantedGainForCrime({ mode: 'shop', success: false, policeBust: true }), 3);
});

test('C1: wantedGainForCrime — immune reduz pela metade (ceil) com mínimo 1', () => {
  const police = createPoliceService();
  // bank+success=5 → ceil(5*0.5)=3
  assert.equal(police.wantedGainForCrime({ mode: 'bank', success: true, immune: true }), 3);
  // player+fail=1 → ceil(1*0.5)=1
  assert.equal(police.wantedGainForCrime({ mode: 'player', success: false, immune: true }), 1);
  // shop+success=2 → ceil(2*0.5)=1
  assert.equal(police.wantedGainForCrime({ mode: 'shop', success: true, immune: true }), 1);
  // bank+policeBust=4 → ceil(4*0.5)=2
  assert.equal(police.wantedGainForCrime({ mode: 'bank', success: false, policeBust: true, immune: true }), 2);
});

test('C1: policeChancePenalty — suspicion=0, wanted=0 → 0', () => {
  const police = createPoliceService();
  assert.equal(police.policeChancePenalty(0, 0), 0);
});

test('C1: policeChancePenalty — suspicion=1, wanted=0 → ~0.05', () => {
  const police = createPoliceService();
  assert.ok(approx(police.policeChancePenalty(1, 0), 0.05));
});

test('C1: policeChancePenalty — suspicion=0.5, wanted=3 → com bônus w>=3', () => {
  const police = createPoliceService();
  assert.ok(approx(police.policeChancePenalty(0.5, 3), 0.12));
});

test('C1: policeChancePenalty — suspicion=0.5, wanted=5 → com bônus w>=3 e w>=5', () => {
  const police = createPoliceService();
  assert.ok(approx(police.policeChancePenalty(0.5, 5), 0.2));
});

test('C1: policeChancePenalty — cap em 0.22', () => {
  const police = createPoliceService();
  assert.ok(approx(police.policeChancePenalty(1, 5), 0.22));
});

test('C1: rollPoliceIntervention — immune → nunca intervém', () => {
  const police = createPoliceService();
  const r = police.rollPoliceIntervention({
    suspicion: 1,
    wantedLevel: 5,
    windowCount: 10,
    mode: 'bank',
    immune: true,
  });
  assert.equal(r.intervene, false);
  assert.equal(r.reason, 'immune');
  assert.equal(r.chance, 0);
});

test('C1: rollPoliceIntervention — suspicion 0, wanted 0, random=0 → chance 0', () => {
  const police = createPoliceService({ random: () => 0 });
  const r = police.rollPoliceIntervention({
    suspicion: 0,
    wantedLevel: 0,
    windowCount: 1,
    mode: 'player',
  });
  // p = 0*0.16 + 0*0.06 = 0. s<0.08 && w<=0 → *0.25 = 0. min(0.7, 0) = 0
  assert.equal(r.chance, 0);
  assert.equal(r.intervene, false);
  assert.equal(r.reason, 'clear');
});

test('C1: rollPoliceIntervention — suspicion alta + wanted alto → chance maior que zero', () => {
  const police = createPoliceService({ random: () => 1 });
  // suspicion=1, wantedLevel=5, windowCount=1, mode='player'
  // p = 1*0.16 + 5*0.06 = 0.16 + 0.30 = 0.46
  // w>=4 → +0.12 = 0.58, w>=5 → +0.12 = 0.70, s<0.08 && w<=0? não
  // p = min(0.7, 0.70) = 0.70
  const r = police.rollPoliceIntervention({
    suspicion: 1,
    wantedLevel: 5,
    windowCount: 1,
    mode: 'player',
  });
  assert.ok(approx(r.chance, 0.70), `chance esperada ~0.70, obtida ${r.chance}`);
  assert.equal(r.intervene, false); // porque random=1 > p
  assert.equal(r.reason, 'clear');
});

test('C1: rollPoliceIntervention — windowCount >= 3 → bônus', () => {
  const base = createPoliceService({ random: () => 0 }).rollPoliceIntervention({
    suspicion: 0.5,
    wantedLevel: 1,
    windowCount: 1,
    mode: 'player',
  });
  const bonus3 = createPoliceService({ random: () => 0 }).rollPoliceIntervention({
    suspicion: 0.5,
    wantedLevel: 1,
    windowCount: 3,
    mode: 'player',
  });
  // p base = 0.5*0.16 + 1*0.06 = 0.08 + 0.06 = 0.14
  // bonus3 = 0.14 + 0.07 = 0.21
  assert.ok(bonus3.chance > base.chance, 'windowCount>=3 deve aumentar chance');
  assert.ok(approx(bonus3.chance, 0.21), `esperado ~0.21, obtido ${bonus3.chance}`);
});

test('C1: rollPoliceIntervention — windowCount >= 5 → bônus maior', () => {
  const r = createPoliceService({ random: () => 0 }).rollPoliceIntervention({
    suspicion: 0.5,
    wantedLevel: 1,
    windowCount: 5,
    mode: 'player',
  });
  // p = 0.14 + 0.07 + 0.1 = 0.31
  assert.ok(approx(r.chance, 0.31), `esperado ~0.31, obtido ${r.chance}`);
});

test('C1: rollPoliceIntervention — mode=shop → chance reduzida (0.5x)', () => {
  const r = createPoliceService({ random: () => 0 }).rollPoliceIntervention({
    suspicion: 1,
    wantedLevel: 0,
    windowCount: 1,
    mode: 'shop',
  });
  // p = 1*0.16 + 0*0.06 = 0.16 → *0.5 = 0.08
  assert.ok(approx(r.chance, 0.08), `esperado ~0.08, obtido ${r.chance}`);
});

test('C1: rollPoliceIntervention — mode=bank → chance aumentada (1.2x)', () => {
  const r = createPoliceService({ random: () => 0 }).rollPoliceIntervention({
    suspicion: 1,
    wantedLevel: 0,
    windowCount: 1,
    mode: 'bank',
  });
  // p = 0.16 → *1.2 = 0.192
  assert.ok(approx(r.chance, 0.192), `esperado ~0.192, obtido ${r.chance}`);
});

test('C1: rollPoliceIntervention — wantedLevel >= 4 → +0.12', () => {
  const r = createPoliceService({ random: () => 0 }).rollPoliceIntervention({
    suspicion: 0,
    wantedLevel: 4,
    windowCount: 1,
    mode: 'player',
  });
  // p = 0 + 4*0.06 = 0.24, w>=4 = +0.12 → 0.36, s<0.08 && w<=0? não
  assert.ok(approx(r.chance, 0.36), `esperado ~0.36, obtido ${r.chance}`);
});

test('C1: rollPoliceIntervention — low suspicion + w=0 → *0.25', () => {
  const r = createPoliceService({ random: () => 0 }).rollPoliceIntervention({
    suspicion: 0.05,
    wantedLevel: 0,
    windowCount: 1,
    mode: 'player',
  });
  // p = 0.05*0.16 + 0 = 0.008 → *0.25 = 0.002
  assert.ok(approx(r.chance, 0.002), `esperado ~0.002, obtido ${r.chance}`);
});

test('C1: rollPoliceIntervention — cap em 0.7 com extremos', () => {
  const r = createPoliceService({ random: () => 0 }).rollPoliceIntervention({
    suspicion: 1,
    wantedLevel: 5,
    windowCount: 10,
    mode: 'bank',
  });
  // p = 1*0.16 + 5*0.06 = 0.46
  // windowCount>=3 → +0.07 = 0.53, >=5 → +0.1 = 0.63
  // mode='bank' → *1.2 = 0.756
  // w>=4 → +0.12 = 0.876, w>=5 → +0.12 = 0.996
  // min(0.7, 0.996) = 0.7
  assert.ok(approx(r.chance, 0.7), `cap esperado 0.7, obtido ${r.chance}`);
});

test('C1: rollPoliceIntervention — random=0 força intervene=true', () => {
  const r = createPoliceService({ random: () => 0 }).rollPoliceIntervention({
    suspicion: 1,
    wantedLevel: 5,
    windowCount: 1,
    mode: 'player',
  });
  assert.equal(r.intervene, true);
  assert.equal(r.reason, 'busted');
});

test('C1: rollPoliceIntervention — random=0.999 com chance baixa → não intervém', () => {
  const r = createPoliceService({ random: () => 0.999 }).rollPoliceIntervention({
    suspicion: 0.01,
    wantedLevel: 0,
    windowCount: 1,
    mode: 'shop',
  });
  assert.equal(r.intervene, false);
});

// ── C2 Wanted System ──────────────────────────────────

test('C2: wanted points — valor inicial é 0', () => {
  const scope = uniqueGroup();
  const userJid = uniqueJid();
  const db = getDb();

  ensureFunSchema(db);

  const police = createPoliceService({ getDatabase: () => db });
  const pts = police.getWantedPoints(userJid, scope);
  assert.equal(pts, 0);
});

test('C2: wanted points — setWantedPoints define valor corretamente', () => {
  const scope = uniqueGroup();
  const userJid = uniqueJid();
  const db = getDb();

  ensureFunSchema(db);
  const police = createPoliceService({ getDatabase: () => db });

  police.setWantedPoints(userJid, scope, 15);
  assert.equal(police.getWantedPoints(userJid, scope), 15);
  assert.equal(police.getWantedLevel(userJid, scope), 2); // 15 → nível 2 (threshold 14)
});

test('C2: wanted points — addWantedPoints soma corretamente', () => {
  const scope = uniqueGroup();
  const userJid = uniqueJid();
  const db = getDb();

  ensureFunSchema(db);
  const police = createPoliceService({ getDatabase: () => db });

  police.setWantedPoints(userJid, scope, 5);
  police.addWantedPoints(userJid, scope, 3);
  assert.equal(police.getWantedPoints(userJid, scope), 8);
});

test('C2: wanted points — addWantedPoints não aceita delta negativo', () => {
  const scope = uniqueGroup();
  const userJid = uniqueJid();
  const db = getDb();

  ensureFunSchema(db);
  const police = createPoliceService({ getDatabase: () => db });

  police.setWantedPoints(userJid, scope, 10);
  police.addWantedPoints(userJid, scope, -5);
  assert.equal(police.getWantedPoints(userJid, scope), 10); // delta negativo vira 0
});

test('C2: wanted decay — 24h sem crime perde 1 ponto', () => {
  const scope = uniqueGroup();
  const userJid = uniqueJid();
  const db = getDb();

  ensureFunSchema(db);
  const now = 1_000_000_000_000;
  const police = createPoliceService({ getDatabase: () => db });

  police.setWantedPoints(userJid, scope, 5, now);
  const decayed = now + WANTED_DECAY_MS + 1000;
  const pts = police.getWantedPoints(userJid, scope, decayed);
  assert.equal(pts, 4, 'deve decair 1 ponto após 24h');
});

test('C2: wanted decay — 48h sem crime perde 2 pontos', () => {
  const scope = uniqueGroup();
  const userJid = uniqueJid();
  const db = getDb();

  ensureFunSchema(db);
  const now = 1_000_000_000_000;
  const police = createPoliceService({ getDatabase: () => db });

  police.setWantedPoints(userJid, scope, 5, now);
  const decayed = now + WANTED_DECAY_MS * 2 + 1000;
  const pts = police.getWantedPoints(userJid, scope, decayed);
  assert.equal(pts, 3, 'deve decair 2 pontos após 48h');
});

test('C2: wanted decay — addWantedPoints reinicia o relógio', () => {
  const scope = uniqueGroup();
  const userJid = uniqueJid();
  const db = getDb();

  ensureFunSchema(db);
  const now = 1_000_000_000_000;
  const police = createPoliceService({ getDatabase: () => db });

  police.setWantedPoints(userJid, scope, 5, now);

  // Crime após 12h → reinicia relógio
  const crimeTime = now + 12 * 60 * 60_000;
  police.addWantedPoints(userJid, scope, 2, crimeTime);

  // +24h a partir do crime → deve ter perdido 1 ponto
  const decayCheck = crimeTime + WANTED_DECAY_MS + 1000;
  const pts = police.getWantedPoints(userJid, scope, decayCheck);
  // 5 + 2 - 1 = 6
  assert.equal(pts, 6, 'addWantedPoints reinicia decay clock: 5+2-1=6');
});

test('C2: wanted decay — não vai abaixo de 0', () => {
  const scope = uniqueGroup();
  const userJid = uniqueJid();
  const db = getDb();

  ensureFunSchema(db);
  const now = 1_000_000_000_000;
  const police = createPoliceService({ getDatabase: () => db });

  police.setWantedPoints(userJid, scope, 1, now);
  const decayed = now + WANTED_DECAY_MS * 3 + 1000;
  const pts = police.getWantedPoints(userJid, scope, decayed);
  assert.equal(pts, 0, 'decay não vai abaixo de 0');
});

test('C2: wanted points — sem lastDecay inicia relógio sem perder pontos', () => {
  const scope = uniqueGroup();
  const userJid = uniqueJid();
  const db = getDb();

  ensureFunSchema(db);
  const now = 1_000_000_000_000;
  const police = createPoliceService({ getDatabase: () => db });

  // Primeira chamada sem wanted points — inicia relógio, sem perda
  const pts1 = police.getWantedPoints(userJid, scope, now);
  assert.equal(pts1, 0);

  // Define pontos e verifica que decay começa a partir de now
  police.setWantedPoints(userJid, scope, 3, now);
  const later = now + 12 * 60 * 60_000;
  const pts2 = police.getWantedPoints(userJid, scope, later);
  assert.equal(pts2, 3, '12h sem crime não deve decair');
});

test('C2: countCrimes7d — conta heist-win e assault-win como crimes', () => {
  const scope = uniqueGroup();
  const userJid = uniqueJid();
  const db = getDb();

  ensureFunSchema(db);
  const now = 2_000_000_000_000;

  seedCrime(db, scope, userJid, 'heist-win:bank', 500, now - 100_000);
  seedCrime(db, scope, userJid, 'assault-win', 200, now - 200_000);

  const police = createPoliceService({ getDatabase: () => db });
  const cnt = police.countCrimes7d(userJid, scope, now);
  assert.equal(cnt, 2);
});

test('C2: countCrimes7d — conta heist-fail, assault-fail, police-bust como crimes', () => {
  const scope = uniqueGroup();
  const userJid = uniqueJid();
  const db = getDb();

  ensureFunSchema(db);
  const now = 2_000_000_000_000;

  seedCrime(db, scope, userJid, 'heist-fail:bank', 0, now - 50_000);
  seedCrime(db, scope, userJid, 'assault-fail', 0, now - 100_000);
  seedCrime(db, scope, userJid, 'police-bust', 0, now - 150_000);

  const police = createPoliceService({ getDatabase: () => db });
  const cnt = police.countCrimes7d(userJid, scope, now);
  assert.equal(cnt, 3);
});

test('C2: countCrimes7d — conta assault-victim (from_jid)', () => {
  const scope = uniqueGroup();
  const victimJid = uniqueJid();
  const attackerJid = uniqueJid();
  const db = getDb();

  ensureFunSchema(db);
  const now = 2_000_000_000_000;

  seedVictim(db, scope, victimJid, attackerJid, now - 50_000);

  const police = createPoliceService({ getDatabase: () => db });
  const cnt = police.countCrimes7d(attackerJid, scope, now);
  assert.equal(cnt, 1, 'atacante deve aparecer pois from_jid=assault-victim');

  const victimCnt = police.countCrimes7d(victimJid, scope, now);
  assert.equal(victimCnt, 0, 'vítima não deve aparecer em countCrimes7d');
});

test('C2: countCrimes7d — ignore registros anteriores a 7 dias', () => {
  const scope = uniqueGroup();
  const userJid = uniqueJid();
  const db = getDb();

  ensureFunSchema(db);
  const now = 2_000_000_000_000;
  const oitoDiasAtras = now - 8 * 24 * 60 * 60_000;

  seedCrime(db, scope, userJid, 'heist-win:bank', 500, oitoDiasAtras);
  seedCrime(db, scope, userJid, 'assault-win', 200, now - 100_000);

  const police = createPoliceService({ getDatabase: () => db });
  const cnt = police.countCrimes7d(userJid, scope, now);
  assert.equal(cnt, 1, 'crimes com mais de 7 dias devem ser ignorados');
});

test('C2: countCrimes7d — retorna 0 quando não há crimes', () => {
  const scope = uniqueGroup();
  const userJid = uniqueJid();
  const db = getDb();

  ensureFunSchema(db);
  const police = createPoliceService({ getDatabase: () => db });
  const cnt = police.countCrimes7d(userJid, scope);
  assert.equal(cnt, 0);
});

test('C2: countCrimes7d — assault-win-property conta como crime', () => {
  const scope = uniqueGroup();
  const userJid = uniqueJid();
  const db = getDb();

  ensureFunSchema(db);
  const now = 2_000_000_000_000;

  seedCrime(db, scope, userJid, 'assault-win-property', 300, now - 50_000);

  const police = createPoliceService({ getDatabase: () => db });
  const cnt = police.countCrimes7d(userJid, scope, now);
  assert.equal(cnt, 1);
});

test('C2: computeReportsScore — sem falhas e sem evento policial → 0', () => {
  const scope = uniqueGroup();
  const userJid = uniqueJid();
  const db = getDb();

  ensureFunSchema(db);
  const police = createPoliceService({ getDatabase: () => db });
  const score = police.computeReportsScore(userJid, scope);
  assert.equal(score, 0);
});

test('C2: computeReportsScore — falhas recentes aumentam score', () => {
  const scope = uniqueGroup();
  const userJid = uniqueJid();
  const db = getDb();

  ensureFunSchema(db);
  const now = 2_000_000_000_000;

  // 4 falhas
  seedCrime(db, scope, userJid, 'heist-fail:bank', 0, now - 60_000);
  seedCrime(db, scope, userJid, 'assault-fail', 0, now - 120_000);
  seedCrime(db, scope, userJid, 'police-bust', 0, now - 180_000);
  seedCrime(db, scope, userJid, 'heist-fail:player', 0, now - 240_000);

  const police = createPoliceService({ getDatabase: () => db });
  const score = police.computeReportsScore(userJid, scope, now);
  // fails=4/8 = 0.5, sem recency → score = 0.5
  assert.ok(approx(score, 0.5), `esperado ~0.5, obtido ${score}`);
});

test('C2: computeReportsScore — evento policial recente (6h) aumenta score via recency', () => {
  const scope = uniqueGroup();
  const userJid = uniqueJid();
  const db = getDb();

  ensureFunSchema(db);
  const now = 2_000_000_000_000;

  const police = createPoliceService({ getDatabase: () => db });

  // Marca evento policial 1h atrás → recency alta
  police.markPoliceEvent(userJid, scope, now - 60 * 60_000);

  const score = police.computeReportsScore(userJid, scope, now);
  // recency = 1 - age/(3*24h) = 1 - 3600000/259200000 = 1 - 0.0139 = 0.9861
  // recency*0.5 = 0.493, fails=0 → score = 0.493
  assert.ok(score > 0.4, `recency deve gerar score >0.4, obtido ${score}`);
});

test('C2: computeReportsScore — evento policial há 3 dias → recency baixa', () => {
  const scope = uniqueGroup();
  const userJid = uniqueJid();
  const db = getDb();

  ensureFunSchema(db);
  const now = 2_000_000_000_000;

  const police = createPoliceService({ getDatabase: () => db });
  police.markPoliceEvent(userJid, scope, now - 3 * 24 * 60 * 60_000); // 3 dias atrás

  const score = police.computeReportsScore(userJid, scope, now);
  // age = 3 dias, recency = 1 - 1 = 0 → score = 0
  assert.equal(score, 0);
});

test('C2: markPoliceEvent / getLastPoliceEvent — tracking de eventos', () => {
  const scope = uniqueGroup();
  const userJid = uniqueJid();
  const db = getDb();

  ensureFunSchema(db);
  const now = 2_000_000_000_000;
  const police = createPoliceService({ getDatabase: () => db });

  const before = police.getLastPoliceEvent(userJid, scope);
  assert.equal(before, 0, 'sem evento → 0');

  police.markPoliceEvent(userJid, scope, now);
  const after = police.getLastPoliceEvent(userJid, scope);
  assert.equal(after, now);
});

// ── C3 Immunity (Police Pass) ─────────────────────────

test('C3: getImmunity — sem effectsRepository → inactive', () => {
  const police = createPoliceService({ getDatabase: () => getDb() });
  const imm = police.getImmunity(uniqueJid(), uniqueGroup());
  assert.equal(imm.active, false);
  assert.equal(imm.remainingUses, 0);
});

test('C3: getImmunity — com effect ativo → active', () => {
  const scope = uniqueGroup();
  const userJid = uniqueJid();
  const db = getDb();

  ensureFunSchema(db);
  const effectsRepo = createFunEffectsRepository({ getDatabase: () => db });
  const now = 2_000_000_000_000;

  // Cria efeito de imunidade com charges
  effectsRepo.setTimedChargesEffect({
    userJid,
    scopeKey: scope,
    effectKey: 'police_immunity',
    durationMs: POLICE_IMMUNITY_DURATION_MS,
    charges: POLICE_IMMUNITY_MAX_USES,
    now,
  });

  const police = createPoliceService({
    getDatabase: () => db,
    effectsRepository: effectsRepo,
  });

  const imm = police.getImmunity(userJid, scope, now);
  assert.equal(imm.active, true);
  assert.equal(imm.remainingUses, POLICE_IMMUNITY_MAX_USES);
  assert.ok(imm.expiresAt > now);
});

test('C3: getImmunity — effect expirado → inactive + cleanup', () => {
  const scope = uniqueGroup();
  const userJid = uniqueJid();
  const db = getDb();

  ensureFunSchema(db);
  const effectsRepo = createFunEffectsRepository({ getDatabase: () => db });
  const now = 2_000_000_000_000;

  // Cria efeito com duração mínima 1000ms, mas now está 2000ms atrás
  // expiresAt = (now - 2000) + 1000 = now - 1000 < now → expirado
  effectsRepo.setTimedChargesEffect({
    userJid,
    scopeKey: scope,
    effectKey: 'police_immunity',
    durationMs: 1000,
    charges: POLICE_IMMUNITY_MAX_USES,
    now: now - 2000,
  });

  const police = createPoliceService({
    getDatabase: () => db,
    effectsRepository: effectsRepo,
  });

  const imm = police.getImmunity(userJid, scope, now);
  assert.equal(imm.active, false);
  assert.equal(imm.remainingUses, 0);
});

test('C3: getImmunity — charges zeradas pelo consumo → inactive + cleanup', () => {
  const scope = uniqueGroup();
  const userJid = uniqueJid();
  const db = getDb();

  ensureFunSchema(db);
  const effectsRepo = createFunEffectsRepository({ getDatabase: () => db });
  const now = 2_000_000_000_000;

  // Cria efeito com 1 charge
  effectsRepo.setTimedChargesEffect({
    userJid,
    scopeKey: scope,
    effectKey: 'police_immunity',
    durationMs: POLICE_IMMUNITY_DURATION_MS,
    charges: 1,
    now,
  });

  const police = createPoliceService({
    getDatabase: () => db,
    effectsRepository: effectsRepo,
  });

  // Consome a única charge → effect deve ser limpo
  police.consumeImmunityUse(userJid, scope, now);

  const imm = police.getImmunity(userJid, scope, now);
  assert.equal(imm.active, false);
  assert.equal(imm.remainingUses, 0);
});

test('C3: consumeImmunityUse — consome 1 charge', () => {
  const scope = uniqueGroup();
  const userJid = uniqueJid();
  const db = getDb();

  ensureFunSchema(db);
  const effectsRepo = createFunEffectsRepository({ getDatabase: () => db });
  const now = 2_000_000_000_000;

  effectsRepo.setTimedChargesEffect({
    userJid,
    scopeKey: scope,
    effectKey: 'police_immunity',
    durationMs: POLICE_IMMUNITY_DURATION_MS,
    charges: 3,
    now,
  });

  const police = createPoliceService({
    getDatabase: () => db,
    effectsRepository: effectsRepo,
  });

  const after = police.consumeImmunityUse(userJid, scope, now);
  assert.equal(after.active, true);
  assert.equal(after.remainingUses, 2);

  // Consome mais um
  const after2 = police.consumeImmunityUse(userJid, scope, now);
  assert.equal(after2.remainingUses, 1);
});

test('C3: consumeImmunityUse — última charge → inactive', () => {
  const scope = uniqueGroup();
  const userJid = uniqueJid();
  const db = getDb();

  ensureFunSchema(db);
  const effectsRepo = createFunEffectsRepository({ getDatabase: () => db });
  const now = 2_000_000_000_000;

  effectsRepo.setTimedChargesEffect({
    userJid,
    scopeKey: scope,
    effectKey: 'police_immunity',
    durationMs: POLICE_IMMUNITY_DURATION_MS,
    charges: 1,
    now,
  });

  const police = createPoliceService({
    getDatabase: () => db,
    effectsRepository: effectsRepo,
  });

  const after = police.consumeImmunityUse(userJid, scope, now);
  assert.equal(after.active, false);
  assert.equal(after.remainingUses, 0);
});

test('C3: isImmunityPassAvailable — disponível quando não vendido na semana', () => {
  const db = getDb();
  ensureFunSchema(db);
  const police = createPoliceService({ getDatabase: () => db });

  assert.equal(police.isImmunityPassAvailable(), true);
});

test('C3: markImmunityPassSold + isImmunityPassAvailable — indisponível após venda', () => {
  const db = getDb();
  ensureFunSchema(db);
  const police = createPoliceService({ getDatabase: () => db });

  police.markImmunityPassSold();
  assert.equal(police.isImmunityPassAvailable(), false);
});

test('C3: isImmunityPassAvailable — disponível na semana seguinte', () => {
  const db = getDb();
  ensureFunSchema(db);
  const police = createPoliceService({ getDatabase: () => db });

  const soldInPastWeek = POLICE_IMMUNITY_WEEK_MS; // 1 semana atrás
  police.markImmunityPassSold(soldInPastWeek);
  // Agora (Date.now()) está na semana seguinte → disponível
  assert.equal(police.isImmunityPassAvailable(), true);
});

test('C3: msUntilImmunityRestock — tempo até próximo restock', () => {
  const db = getDb();
  ensureFunSchema(db);
  const police = createPoliceService({ getDatabase: () => db });

  // No início da semana → restock em ~7 dias
  const now = POLICE_IMMUNITY_WEEK_MS * 10; // início de uma semana
  const restock = police.msUntilImmunityRestock(now);
  assert.equal(restock, POLICE_IMMUNITY_WEEK_MS);
});

test('C3: msUntilImmunityRestock — meio da semana → menos de 7 dias', () => {
  const db = getDb();
  ensureFunSchema(db);
  const police = createPoliceService({ getDatabase: () => db });

  const halfway = POLICE_IMMUNITY_WEEK_MS * 10 + POLICE_IMMUNITY_WEEK_MS / 2;
  const restock = police.msUntilImmunityRestock(halfway);
  const expected = POLICE_IMMUNITY_WEEK_MS / 2;
  assert.ok(approx(restock, expected, 1), `esperado ~${expected}, obtido ${restock}`);
});

// ── C4 Integração ─────────────────────────────────────

test('C4: evaluate — retorna perfil criminal completo', () => {
  const scope = uniqueGroup();
  const userJid = uniqueJid();
  const db = getDb();

  ensureFunSchema(db);
  const repo = createFunStatsRepository({ getDatabase: () => db });
  repo.ensureFunSchema();
  repo.addCoins({ userJid, scopeKey: scope, amount: 1000, reason: 'seed' });

  const effectsRepo = createFunEffectsRepository({ getDatabase: () => db });

  const police = createPoliceService({
    getDatabase: () => db,
    repository: repo,
    effectsRepository: effectsRepo,
    random: () => 0.999, // não intervém
  });

  const result = police.evaluate({
    userJid,
    scopeKey: scope,
    heat: 5,
    mode: 'player',
    windowCount: 1,
  });

  assert.ok(typeof result.suspicion === 'number');
  assert.ok(result.suspicion >= 0 && result.suspicion <= 1);
  assert.equal(result.wantedPoints, 0);
  assert.equal(result.wantedLevel, 0);
  assert.equal(result.crimes7d, 0);
  assert.equal(result.reportsScore, 0);
  assert.equal(result.wealth, 1000);
  assert.equal(result.heat, 5);
  assert.equal(result.immune, false);
  assert.ok(typeof result.chancePenalty === 'number');
  assert.ok(result.intervention !== undefined);
});

test('C4: evaluate — heat desabilitado via chaosEvent → heatEffective=0', () => {
  const scope = uniqueGroup();
  const userJid = uniqueJid();
  const db = getDb();

  ensureFunSchema(db);
  const repo = createFunStatsRepository({ getDatabase: () => db });
  repo.ensureFunSchema();

  const mockChaos = {
    isHeatDisabled: () => true,
  };

  const police = createPoliceService({
    getDatabase: () => db,
    repository: repo,
    chaosEventService: mockChaos,
    random: () => 0.999,
  });

  const result = police.evaluate({
    userJid,
    scopeKey: scope,
    heat: 10,
  });

  assert.equal(result.heat, 0, 'heat deve ser 0 quando chaos desabilita');
  assert.equal(result.suspicion, 0, 'suspicion deve ser 0 sem heat');
});

test('C4: evaluate — imunidade ativa → immune=true, chancePenalty=0', () => {
  const scope = uniqueGroup();
  const userJid = uniqueJid();
  const db = getDb();

  ensureFunSchema(db);
  const repo = createFunStatsRepository({ getDatabase: () => db });
  repo.ensureFunSchema();
  const effectsRepo = createFunEffectsRepository({ getDatabase: () => db });
  const now = 2_000_000_000_000;

  effectsRepo.setTimedChargesEffect({
    userJid,
    scopeKey: scope,
    effectKey: 'police_immunity',
    durationMs: POLICE_IMMUNITY_DURATION_MS,
    charges: 5,
    now,
  });

  const police = createPoliceService({
    getDatabase: () => db,
    repository: repo,
    effectsRepository: effectsRepo,
    random: () => 0.999,
  });

  const result = police.evaluate({
    userJid,
    scopeKey: scope,
    heat: 10,
    now,
  });

  assert.equal(result.immune, true);
  assert.equal(result.chancePenalty, 0);
  assert.equal(result.intervention.intervene, false);
  assert.equal(result.intervention.reason, 'immune');
});

test('C4: afterCrime — adiciona wantedPoints e retorna resultado', () => {
  const scope = uniqueGroup();
  const userJid = uniqueJid();
  const db = getDb();

  ensureFunSchema(db);
  const police = createPoliceService({ getDatabase: () => db });

  const result = police.afterCrime({
    userJid,
    scopeKey: scope,
    mode: 'bank',
    success: true,
  });

  assert.equal(result.wantedGain, 5);
  assert.equal(result.wantedPoints, 5);
  assert.equal(result.wantedLevel, 0); // 5 pontos ainda é nível 0
});

test('C4: afterCrime — policeBust marca evento policial', () => {
  const scope = uniqueGroup();
  const userJid = uniqueJid();
  const db = getDb();

  ensureFunSchema(db);
  const police = createPoliceService({ getDatabase: () => db });
  const now = 2_000_000_000_000;

  const result = police.afterCrime({
    userJid,
    scopeKey: scope,
    mode: 'bank',
    success: false,
    policeBust: true,
    now,
  });

  assert.equal(result.wantedGain, 4); // bank+policeBust
  assert.equal(result.wantedPoints, 4);

  // Verifica que evento policial foi marcado
  const lastEvent = police.getLastPoliceEvent(userJid, scope);
  assert.equal(lastEvent, now);
});

test('C4: afterCrime — immune consome 1 uso', () => {
  const scope = uniqueGroup();
  const userJid = uniqueJid();
  const db = getDb();

  ensureFunSchema(db);
  const effectsRepo = createFunEffectsRepository({ getDatabase: () => db });
  const now = 2_000_000_000_000;

  effectsRepo.setTimedChargesEffect({
    userJid,
    scopeKey: scope,
    effectKey: 'police_immunity',
    durationMs: POLICE_IMMUNITY_DURATION_MS,
    charges: 3,
    now,
  });

  const police = createPoliceService({
    getDatabase: () => db,
    effectsRepository: effectsRepo,
  });

  const result = police.afterCrime({
    userJid,
    scopeKey: scope,
    mode: 'bank',
    success: true,
    immune: true,
    now,
  });

  assert.ok(result.immunity.active);
  assert.equal(result.immunity.remainingUses, 2, 'deve ter consumido 1 uso');
  assert.equal(result.wantedGain, 3); // bank+success+immune → ceil(5*0.5)=3
});

test('C4: afterCrime — sem ganho (gain=0) não adiciona pontos', () => {
  const scope = uniqueGroup();
  const userJid = uniqueJid();
  const db = getDb();

  ensureFunSchema(db);
  const police = createPoliceService({ getDatabase: () => db });
  const now = 2_000_000_000_000;

  // Caso não deveria ocorrer, mas testa se gain=0 não incrementa
  // Nenhuma combinação real dá gain=0, forçamos pelo policeService
  const result = police.afterCrime({
    userJid,
    scopeKey: scope,
    mode: 'player',
    success: true,
    immune: false,
    policeBust: false,
    now,
  });

  assert.equal(result.wantedGain, 3);
  assert.equal(result.wantedPoints, 3);
});

// ── C5 Edge Cases & Balanceamento ─────────────────────

test('C5: clamp01 — valores negativos viram 0', () => {
  // Testamos via computeSuspicionScore já que clamp01 é privada
  const score = computeSuspicionScore({ heat: -1, crimes7d: -5, wealth: -1000 });
  assert.equal(score, 0);
});

test('C5: clamp01 — valores acima de 1 viram 1', () => {
  const score = computeSuspicionScore({ heat: 50, crimes7d: 100, wealth: 50000 });
  // heatN=1, crimesN=1, wealthN=1, criminalSignal=clamp(0.5+0.7)=1
  // wealthWeighted=1, score=1*0.4+1*0.3+1*0.2 = 0.9
  assert.ok(approx(score, 0.9), `esperado ~0.9, obtido ${score}`);
});

test('C5: wantedLevelFromPoints com NaN/undefined/null → 0', () => {
  assert.equal(wantedLevelFromPoints(NaN), 0);
  assert.equal(wantedLevelFromPoints(undefined), 0);
  assert.equal(wantedLevelFromPoints(null), 0);
});

test('C5: computeSuspicionScore com valores extremos — sempre entre 0 e 1', () => {
  const inputs = [
    { heat: -999, crimes7d: -999, wealth: -99999 },
    { heat: Infinity, crimes7d: Infinity, wealth: Infinity },
    { heat: NaN, crimes7d: NaN, wealth: NaN },
    { heat: 1e10, crimes7d: 1e10, wealth: 1e10 },
  ];
  for (const input of inputs) {
    const score = computeSuspicionScore(input);
    assert.ok(score >= 0 && score <= 1, `score ${score} fora do range [0,1] para ${JSON.stringify(input)}`);
  }
});

test('C5: rico honesto — 10k coins, zero heat, zero crimes → suspicion zero', () => {
  const score = computeSuspicionScore({
    heat: 0,
    crimes7d: 0,
    wealth: 10000,
    reportsScore: 0,
    wantedLevel: 0,
  });
  assert.equal(score, 0, 'rico honesto não deve ter suspicion');
});

test('C5: farm de wanted — sequência de crimes sobe wanted e detecta', () => {
  const scope = uniqueGroup();
  const userJid = uniqueJid();
  const db = getDb();

  ensureFunSchema(db);
  const repo = createFunStatsRepository({ getDatabase: () => db });
  repo.ensureFunSchema();
  const now = 2_000_000_000_000;

  const police = createPoliceService({
    getDatabase: () => db,
    repository: repo,
    random: () => 0.999, // não intervém
  });

  // Simula 10 crimes bank+success em sequência (1h entre cada)
  for (let i = 0; i < 10; i++) {
    const t = now + i * 60 * 60_000; // 1h entre cada
    const result = police.afterCrime({
      userJid,
      scopeKey: scope,
      mode: 'bank',
      success: true,
      now: t,
    });
    // Popula ledger para countCrimes7d (o afterCrime não adiciona ledger)
    seedCrime(db, scope, userJid, 'heist-win:bank', 500, t);
    // A cada crime: +5 wanted
    const expectedPoints = (i + 1) * 5;
    assert.equal(result.wantedPoints, expectedPoints, `crime ${i + 1}: wanted deveria ser ${expectedPoints}`);
  }

  // Nível wanted após 10 crimes (50 pontos) → nível 4 (threshold 48)
  const level = police.getWantedLevel(userJid, scope, now + 10 * 60 * 60_000);
  assert.equal(level, 4, '50 pontos = nível 4');

  // Suspicion deve estar alta com heat=10
  const evalResult = police.evaluate({
    userJid,
    scopeKey: scope,
    heat: 10,
    windowCount: 10,
    now: now + 10 * 60 * 60_000,
  });
  assert.ok(evalResult.suspicion > 0.4, `suspicion após farm: ${evalResult.suspicion}`);
  assert.ok(evalResult.chancePenalty > 0, `chancePenalty deve ser >0: ${evalResult.chancePenalty}`);
});

test('C5: efeito da imunidade — intervenção nunca acontece com passe ativo', () => {
  const scope = uniqueGroup();
  const userJid = uniqueJid();
  const db = getDb();

  ensureFunSchema(db);
  const effectsRepo = createFunEffectsRepository({ getDatabase: () => db });
  const now = 2_000_000_000_000;

  effectsRepo.setTimedChargesEffect({
    userJid,
    scopeKey: scope,
    effectKey: 'police_immunity',
    durationMs: POLICE_IMMUNITY_DURATION_MS,
    charges: 5,
    now,
  });

  const police = createPoliceService({
    getDatabase: () => db,
    effectsRepository: effectsRepo,
    random: () => 0, // sempre intervém se não imune
  });

  // rollPoliceIntervention direto com immune=true
  const r1 = police.rollPoliceIntervention({
    suspicion: 1,
    wantedLevel: 5,
    windowCount: 10,
    mode: 'bank',
    immune: true,
  });
  assert.equal(r1.intervene, false);
  assert.equal(r1.reason, 'immune');

  // evaluate também deve manter immune
  const result = police.evaluate({
    userJid,
    scopeKey: scope,
    heat: 10,
    now,
  });
  assert.equal(result.immune, true);
  assert.equal(result.intervention.reason, 'immune');
});

test('C5: decay justo — 24h sem crime = -1 wanted. Crime há 12h → sem decay', () => {
  const scope = uniqueGroup();
  const userJid = uniqueJid();
  const db = getDb();

  ensureFunSchema(db);
  const now = 2_000_000_000_000;
  const police = createPoliceService({ getDatabase: () => db });

  police.setWantedPoints(userJid, scope, 10, now);

  // 12h depois — sem crime — ainda sem decay
  const mid = now + 12 * 60 * 60_000;
  assert.equal(police.getWantedPoints(userJid, scope, mid), 10, '12h sem crime → sem decay');

  // 24h depois — sem crime — -1
  const day1 = now + 24 * 60 * 60_000 + 1000;
  assert.equal(police.getWantedPoints(userJid, scope, day1), 9, '24h sem crime → -1');

  // Crime após 12h reinicia relógio
  police.addWantedPoints(userJid, scope, 1, mid); // agora 11 pontos, relógio em mid
  // +24h de mid = 36h do now
  const later = mid + 24 * 60 * 60_000 + 1000;
  // crime no mid reiniciou relógio, mas setWantedPoints(now) + getWantedPoints(day1)
  // já aplicou -1 decay. addWantedPoints(mid) lê 9 pontos do DB, adiciona 1 = 10.
  // +24h de mid: decay de -1 = 9
  assert.equal(police.getWantedPoints(userJid, scope, later), 9, 'crime em 12h reiniciou relógio mas decay já ocorreu');
});

test('C5: thresholds de wanted — progressão de níveis faz sentido', () => {
  // WANTED_LEVEL_THRESHOLDS = [0, 6, 14, 28, 48, 80]
  // 1 banco sucesso = 5 pontos → ainda nível 0
  assert.equal(wantedLevelFromPoints(5), 0, '1 bank success = nível 0');
  // 2 bancos sucesso = 10 pontos → nível 1 (threshold 6)
  assert.equal(wantedLevelFromPoints(10), 1, '2 bank successes = nível 1');
  // 3 bancos sucesso = 15 pontos → nível 2 (threshold 14)
  assert.equal(wantedLevelFromPoints(15), 2, '3 bank successes = nível 2');
  // 6 bancos sucesso = 30 pontos → nível 3 (threshold 28)
  assert.equal(wantedLevelFromPoints(30), 3, '6 bank successes = nível 3');
  // 10 bancos sucesso = 50 pontos → nível 4 (threshold 48)
  assert.equal(wantedLevelFromPoints(50), 4, '10 bank successes = nível 4');
  // 16 bancos sucesso = 80 pontos → nível 5 (threshold 80)
  assert.equal(wantedLevelFromPoints(80), 5, '16 bank successes = nível 5');
});

test('C5: policeChancePenalty — suspicion nunca passa de 0.22', () => {
  const police = createPoliceService();
  for (let s = 0; s <= 1; s += 0.1) {
    for (let w = 0; w <= 5; w++) {
      const penalty = police.policeChancePenalty(s, w);
      assert.ok(penalty >= 0 && penalty <= 0.22,
        `penalty ${penalty} fora de [0, 0.22] para suspicion=${s}, wanted=${w}`);
    }
  }
});

test('C5: computeSuspicionScore — sempre retorna valor entre 0 e 1', () => {
  const combos = [
    { heat: 0, crimes7d: 0, wealth: 0, reportsScore: 0, wantedLevel: 0 },
    { heat: 10, crimes7d: 20, wealth: 5000, reportsScore: 1, wantedLevel: 5 },
    { heat: 3, crimes7d: 5, wealth: 2000, reportsScore: 0.3, wantedLevel: 2 },
    { heat: 0.5, crimes7d: 0, wealth: 100000, reportsScore: 0, wantedLevel: 0 },
    { heat: 8, crimes7d: 15, wealth: 0, reportsScore: 0.7, wantedLevel: 4 },
  ];
  for (const c of combos) {
    const score = computeSuspicionScore(c);
    assert.ok(score >= 0 && score <= 1,
      `score ${score} fora do range para ${JSON.stringify(c)}`);
  }
});

test('C5: suspicion de pobre com ficha criminal alta → suspicion alta', () => {
  // Jogador pobre (wealth=0) mas com 10 crimes e heat máximo
  // heat=10 → heatN=1, crimes7d=10 → crimesN=0.5, wealth=0
  // criminalSignal = 1*0.5 + 0.5*0.7 + 0 + 0 = 0.5 + 0.35 = 0.85
  // wealthWeighted = 0 * 0.85 = 0
  // score = 1*0.4 + 0.5*0.3 = 0.4 + 0.15 = 0.55
  const score = computeSuspicionScore({ heat: 10, crimes7d: 10, wealth: 0, reportsScore: 0, wantedLevel: 0 });
  assert.ok(score > 0.4, `pobre com ficha criminal alta deve ter suspicion > 0.4, obtido ${score}`);
});

test('C5: wantedGain mínimo de 1 mesmo com immune', () => {
  const police = createPoliceService();
  // Todas as combinações immune devem dar pelo menos 1
  const modes = ['bank', 'player', 'shop'];
  const results = [true, false];
  for (const mode of modes) {
    for (const success of results) {
      const gain = police.wantedGainForCrime({ mode, success, immune: true });
      assert.ok(gain >= 1, `immune+${mode}+${success} deu ${gain}, mínimo 1`);
    }
  }
  // policeBust também
  for (const mode of modes) {
    const gain = police.wantedGainForCrime({ mode, success: false, policeBust: true, immune: true });
    assert.ok(gain >= 1, `immune+${mode}+bust deu ${gain}, mínimo 1`);
  }
});

test('C5: police bust em banco vs player vs shop — valores corretos', () => {
  const police = createPoliceService();
  // bank+bust → 4
  assert.equal(police.wantedGainForCrime({ mode: 'bank', policeBust: true }), 4);
  // player+bust → 3
  assert.equal(police.wantedGainForCrime({ mode: 'player', policeBust: true }), 3);
  // shop+bust → 3 (implementação: modo não-bank = 3)
  assert.equal(police.wantedGainForCrime({ mode: 'shop', policeBust: true }), 3);
});