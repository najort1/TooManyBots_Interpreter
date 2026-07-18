import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import {
  _resetDefaultFunStatsRepository,
  createFunStatsRepository,
} from '../fun/db/funStatsRepository.js';
import { createFunJobRepository } from '../fun/db/funJobRepository.js';
import { createJobService } from '../fun/services/jobService.js';
import { effectiveSalary, getJob, listJobs } from '../fun/jobs/catalog.js';
import { signJobToken, verifyJobToken } from '../fun/jobs/token.js';
import {
  clearPublicUrlCache,
  getPublicBaseUrl,
  writePublicBaseUrl,
  FUN_PUBLIC_CONFIG_PATH,
} from '../fun/utils/publicUrl.js';
import { resolveFunConfig } from '../fun/index.js';
import { parseFunCommand } from '../fun/commands/router.js';
import { FUN_COMMANDS } from '../fun/constants.js';
import fs from 'fs';

await initDb();
_resetDefaultFunStatsRepository();

function uniqueJid(prefix = '5511') {
  return `${prefix}${String(Date.now()).slice(-7)}${Math.floor(Math.random() * 90 + 10)}@s.whatsapp.net`;
}

function uniqueGroup() {
  return `120363${String(Date.now()).slice(-10)}${Math.floor(Math.random() * 90 + 10)}@g.us`;
}

test('parseFunCommand: emprego/demitir', () => {
  assert.equal(parseFunCommand('/emprego', '/').command, FUN_COMMANDS.EMPLOYMENT);
  assert.equal(parseFunCommand('/emprego bombeiro', '/').command, FUN_COMMANDS.EMPLOYMENT);
  assert.equal(parseFunCommand('/demitir', '/').command, FUN_COMMANDS.RESIGN);
  assert.equal(parseFunCommand('/trabalhar', '/').command, FUN_COMMANDS.JOB);
});

test('catalog: 3 cargos e diluição de salário', () => {
  assert.equal(listJobs().length, 3);
  assert.ok(getJob('bombeiro'));
  assert.equal(effectiveSalary(getJob('bombeiro'), 1), 50);
  assert.equal(effectiveSalary(getJob('bombeiro'), 2), 45);
  assert.equal(effectiveSalary(getJob('hacker'), 5), 48); // 80*0.6=48 > floor 40
  assert.equal(effectiveSalary(getJob('estagiario'), 5), 18); // 30*0.6=18 > 15
});

test('token HMAC assina e valida', () => {
  const secret = 'test-secret';
  const payload = { aid: 'x', jid: 'a@s.whatsapp.net', exp: Date.now() + 60_000 };
  const t = signJobToken(payload, secret);
  const v = verifyJobToken(t, secret);
  assert.equal(v.ok, true);
  assert.equal(v.payload.aid, 'x');
  const expired = signJobToken({ ...payload, exp: Date.now() - 1000 }, secret);
  assert.equal(verifyJobToken(expired, secret).ok, false);
});

test('publicBaseUrl hot-reload via config.public.json', () => {
  clearPublicUrlCache();
  const prev = fs.existsSync(FUN_PUBLIC_CONFIG_PATH)
    ? fs.readFileSync(FUN_PUBLIC_CONFIG_PATH, 'utf8')
    : null;
  try {
    writePublicBaseUrl('https://demo-tunnel.example.com');
    clearPublicUrlCache();
    const u = getPublicBaseUrl({}, { force: true });
    assert.equal(u, 'https://demo-tunnel.example.com');
  } finally {
    if (prev != null) fs.writeFileSync(FUN_PUBLIC_CONFIG_PATH, prev, 'utf8');
    else if (fs.existsSync(FUN_PUBLIC_CONFIG_PATH)) fs.unlinkSync(FUN_PUBLIC_CONFIG_PATH);
    clearPublicUrlCache();
  }
});

test('fluxo: candidatar, passar teste, salário daily, demitir', () => {
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const jobRepo = createFunJobRepository({ getDatabase: getDb });
  const jobs = createJobService({ repository: repo, jobRepository: jobRepo });
  const scope = uniqueGroup();
  const u = uniqueJid('5577');
  repo.addCoins({ userJid: u, scopeKey: scope, amount: 500, reason: 'seed' });
  const cfg = resolveFunConfig({
    publicBaseUrl: 'https://test.local',
    jobTokenSecret: 'unit-test-secret',
    jobLinkTtlMs: 15 * 60_000,
  });

  const app = jobs.startApplication({
    userJid: u,
    scopeKey: scope,
    jobId: 'bombeiro',
    funConfig: cfg,
  });
  assert.equal(app.ok, true);
  assert.equal(app.fee, 0); // 1ª grátis
  // publicBaseUrl: config.public.json (cloudflared) tem prioridade sobre funConfig
  assert.ok(app.link.includes('/job/play?t='), app.link);
  assert.ok(app.link.includes('&c='), 'link deve carregar código na query');
  assert.ok(app.code.length >= 4);

  const noCode = jobs.openAttempt({ token: app.token, funConfig: cfg });
  assert.equal(noCode.ok, false);
  assert.equal(noCode.reason, 'code-required');

  const open = jobs.openAttempt({ token: app.token, code: app.code, funConfig: cfg });
  assert.equal(open.ok, true);
  assert.equal(open.game, 'fire');

  const fin = jobs.finishAttempt({
    attemptId: app.attempt.id,
    token: app.token,
    score: 20,
    durationMs: 20_000,
    metrics: { lostHouses: 0 },
    funConfig: cfg,
  });
  assert.equal(fin.ok, true);
  assert.equal(fin.passed, true);
  assert.equal(fin.job.id, 'bombeiro');
  assert.ok(fin.salary >= 25);

  const emp = jobs.getEmployment(u, scope);
  assert.equal(emp.jobId, 'bombeiro');

  // segunda candidatura bloqueada
  const again = jobs.startApplication({
    userJid: u,
    scopeKey: scope,
    jobId: 'hacker',
    funConfig: cfg,
  });
  assert.equal(again.ok, false);
  assert.equal(again.reason, 'already-employed');

  const pay = jobs.applyDailySalary({ userJid: u, scopeKey: scope });
  assert.ok(pay.paid >= 25);
  const coinsAfter = repo.getUserStats(u, scope).coins;
  assert.ok(coinsAfter > 500 - 0);

  const res = jobs.resign({ userJid: u, scopeKey: scope });
  assert.equal(res.ok, true);
  assert.equal(jobs.getEmployment(u, scope), null);
});

test('falha no teste: CD 7 dias + taxa na retentativa', () => {
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const jobRepo = createFunJobRepository({ getDatabase: getDb });
  const jobs = createJobService({ repository: repo, jobRepository: jobRepo });
  const scope = uniqueGroup();
  const u = uniqueJid('5566');
  repo.addCoins({ userJid: u, scopeKey: scope, amount: 200, reason: 'seed' });
  const cfg = resolveFunConfig({
    publicBaseUrl: 'https://test.local',
    jobTokenSecret: 'unit-test-secret-2',
  });

  const app = jobs.startApplication({
    userJid: u,
    scopeKey: scope,
    jobId: 'estagiario',
    funConfig: cfg,
  });
  assert.equal(app.ok, true);

  const fail = jobs.finishAttempt({
    attemptId: app.attempt.id,
    token: app.token,
    score: 1,
    durationMs: 5_000,
    metrics: { mistakes: 5 },
    funConfig: cfg,
  });
  assert.equal(fail.passed, false);

  const blocked = jobs.startApplication({
    userJid: u,
    scopeKey: scope,
    jobId: 'estagiario',
    funConfig: cfg,
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'cooldown');

  // outro cargo ainda pode (CD por cargo)
  const other = jobs.startApplication({
    userJid: u,
    scopeKey: scope,
    jobId: 'bombeiro',
    funConfig: cfg,
  });
  assert.equal(other.ok, true);
  assert.equal(other.fee, 0);
});

test('treino grátis: 1× por attempt no banco (F5 não libera outro)', () => {
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const jobRepo = createFunJobRepository({ getDatabase: getDb });
  const jobs = createJobService({ repository: repo, jobRepository: jobRepo });
  const scope = uniqueGroup();
  const u = uniqueJid('5588');
  repo.addCoins({ userJid: u, scopeKey: scope, amount: 100, reason: 'seed' });
  const cfg = resolveFunConfig({
    publicBaseUrl: 'https://test.local',
    jobTokenSecret: 'unit-test-practice',
  });

  const app = jobs.startApplication({
    userJid: u,
    scopeKey: scope,
    jobId: 'bombeiro',
    funConfig: cfg,
  });
  assert.equal(app.ok, true);

  const open = jobs.openAttempt({ token: app.token, code: app.code, funConfig: cfg });
  assert.equal(open.ok, true);
  assert.equal(open.practiceAvailable, true);
  assert.equal(open.practiceUsed, false);

  const claim = jobs.claimPractice({
    attemptId: app.attempt.id,
    token: app.token,
    funConfig: cfg,
  });
  assert.equal(claim.ok, true);
  assert.equal(claim.practiceUsed, true);

  // segundo claim (simula F5 + treino de novo) bloqueia
  const again = jobs.claimPractice({
    attemptId: app.attempt.id,
    token: app.token,
    funConfig: cfg,
  });
  assert.equal(again.ok, false);
  assert.equal(again.reason, 'practice-used');

  const open2 = jobs.openAttempt({ token: app.token, code: app.code, funConfig: cfg });
  assert.equal(open2.ok, true);
  assert.equal(open2.practiceAvailable, false);
  assert.equal(open2.practiceUsed, true);

  const prac = jobs.finishPractice({
    attemptId: app.attempt.id,
    token: app.token,
    score: 7,
    metrics: { lostHouses: 1 },
    funConfig: cfg,
  });
  assert.equal(prac.ok, true);
  assert.equal(prac.practice, true);
  assert.equal(prac.score, 7);

  // treino não aplica CD nem contrata
  assert.equal(jobs.getEmployment(u, scope), null);
  const stillOpen = jobs.startApplication({
    userJid: u,
    scopeKey: scope,
    jobId: 'hacker',
    funConfig: cfg,
  });
  // ainda sem emprego; pode candidatar a outro cargo (não bloqueado por CD do bombeiro)
  assert.equal(stillOpen.ok, true);

  // teste real ainda funciona no mesmo attempt do bombeiro
  const real = jobs.finishAttempt({
    attemptId: app.attempt.id,
    token: app.token,
    score: 20,
    durationMs: 25_000,
    metrics: { lostHouses: 0 },
    funConfig: cfg,
  });
  assert.equal(real.ok, true);
  assert.equal(real.passed, true);
  assert.equal(jobs.getEmployment(u, scope)?.jobId, 'bombeiro');
});

test('validateGameResult rejeita score impossível', () => {
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const jobRepo = createFunJobRepository({ getDatabase: getDb });
  const jobs = createJobService({ repository: repo, jobRepository: jobRepo });
  const job = getJob('hacker');
  assert.equal(job.game, 'firewall');
  const bad = jobs.validateGameResult(job, { score: 99, durationMs: 10_000, metrics: {} });
  assert.equal(bad.ok, false);
  const good = jobs.validateGameResult(job, {
    score: 16,
    durationMs: 40_000,
    metrics: { hits: 0, consecutiveMisses: 0 },
  });
  assert.equal(good.ok, true);
  assert.equal(good.passed, true);
  const hitFail = jobs.validateGameResult(job, {
    score: 16,
    durationMs: 40_000,
    metrics: { hits: 3, consecutiveMisses: 0 },
  });
  assert.equal(hitFail.passed, false);
});

test('diluição: 2 bombeiros baixam salário', () => {
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const jobRepo = createFunJobRepository({ getDatabase: getDb });
  const jobs = createJobService({ repository: repo, jobRepository: jobRepo });
  const scope = uniqueGroup();
  const a = uniqueJid('5551');
  const b = uniqueJid('5552');
  jobRepo.setUserJob({ userJid: a, scopeKey: scope, jobId: 'bombeiro' });
  jobRepo.setUserJob({ userJid: b, scopeKey: scope, jobId: 'bombeiro' });
  const ea = jobs.getEmployment(a, scope);
  assert.equal(ea.workers, 2);
  assert.equal(ea.salary, 45);
});
