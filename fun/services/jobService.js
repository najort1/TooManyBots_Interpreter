/**
 * Serviço de profissões: inscrição, teste, salário no daily, demissão.
 */

import crypto from 'crypto';
import {
  getJob,
  listJobs,
  effectiveSalary,
  salaryMultiplier,
} from '../jobs/catalog.js';
import { signJobToken, verifyJobToken, randomCode } from '../jobs/token.js';
import { getPublicBaseUrl } from '../utils/publicUrl.js';

const WEEK_MS = 7 * 24 * 60 * 60_000;
const DEFAULT_LINK_TTL = 15 * 60_000;
const INACTIVITY_MISSED = 3;

function secretOf(funConfig = {}) {
  return (
    String(funConfig.jobTokenSecret || process.env.FUN_JOB_TOKEN_SECRET || '').trim() ||
    'fun-job-dev-secret-change-me'
  );
}

function pathOf(funConfig = {}) {
  const p = String(funConfig.jobTestPath || '/job/play').trim() || '/job/play';
  return p.startsWith('/') ? p : `/${p}`;
}

export function createJobService({
  repository,
  jobRepository,
  random = Math.random,
} = {}) {
  if (!repository) throw new Error('[fun/jobService] repository required');
  if (!jobRepository) throw new Error('[fun/jobService] jobRepository required');

  function listWithMarket(scopeKey) {
    return listJobs().map((job) => {
      const n = jobRepository.countInJob(scopeKey, job.id);
      return {
        ...job,
        workers: n,
        salary: effectiveSalary(job, Math.max(1, n)),
        salaryIfJoin: effectiveSalary(job, n + 1),
        mult: salaryMultiplier(Math.max(1, n)),
      };
    });
  }

  function getEmployment(userJid, scopeKey) {
    const row = jobRepository.getUserJob(userJid, scopeKey);
    if (!row?.jobId) return null;
    const job = getJob(row.jobId);
    if (!job) return null;
    const n = jobRepository.countInJob(scopeKey, job.id);
    return {
      ...row,
      job,
      workers: n,
      salary: effectiveSalary(job, n),
    };
  }

  function checkCooldown(userJid, scopeKey, jobId, now = Date.now()) {
    const cd = jobRepository.getCooldown(userJid, scopeKey, jobId);
    if (!cd || !cd.nextAttemptAt) return { ok: true };
    if (now >= cd.nextAttemptAt) return { ok: true, attemptCount: cd.attemptCount };
    return {
      ok: false,
      reason: 'cooldown',
      nextAttemptAt: cd.nextAttemptAt,
      retryInMs: cd.nextAttemptAt - now,
      attemptCount: cd.attemptCount,
    };
  }

  /**
   * Abre tentativa de teste. Cobra taxa se não for 1ª vez no cargo.
   */
  function startApplication({
    userJid,
    scopeKey,
    jobId,
    funConfig = {},
    now = Date.now(),
  }) {
    const job = getJob(jobId);
    if (!job) return { ok: false, reason: 'unknown-job' };

    const u = String(userJid || '').trim();
    const s = String(scopeKey || '').trim();
    if (!u || !s) return { ok: false, reason: 'invalid-identity' };

    const current = jobRepository.getUserJob(u, s);
    if (current?.jobId) {
      return {
        ok: false,
        reason: 'already-employed',
        jobId: current.jobId,
      };
    }

    const cd = checkCooldown(u, s, job.id, now);
    if (!cd.ok) return cd;

    const prior = jobRepository.countPriorAttempts(u, s, job.id);
    const isFirst = prior === 0;
    const fee = isFirst && job.firstAttemptFree !== false ? 0 : Number(job.retryFee) || 0;

    if (fee > 0) {
      const stats = repository.ensureUserRow(u, s, now);
      if ((Number(stats.coins) || 0) < fee) {
        return {
          ok: false,
          reason: 'insufficient-funds',
          fee,
          coins: Number(stats.coins) || 0,
        };
      }
      const spent = repository.addCoins({
        userJid: u,
        scopeKey: s,
        amount: -fee,
        now,
        reason: `job-fee:${job.id}`,
      });
      if (!spent.ok) return { ok: false, reason: 'spend-failed' };
    }

    const ttl = Math.max(60_000, Number(funConfig.jobLinkTtlMs) || DEFAULT_LINK_TTL);
    const expiresAt = now + ttl;
    const code = randomCode(6);
    const tokenNonce = crypto.randomBytes(8).toString('hex');
    const attempt = jobRepository.createAttempt({
      userJid: u,
      scopeKey: s,
      jobId: job.id,
      code,
      tokenNonce,
      expiresAt,
      now,
    });

    const payload = {
      aid: attempt.id,
      jid: u,
      scope: s,
      job: job.id,
      nonce: tokenNonce,
      exp: expiresAt,
    };
    const token = signJobToken(payload, secretOf(funConfig));
    const base = getPublicBaseUrl(funConfig);
    const playPath = pathOf(funConfig);
    const link = `${base}${playPath}?t=${encodeURIComponent(token)}&c=${encodeURIComponent(code)}`;

    return {
      ok: true,
      job,
      attempt,
      token,
      code,
      link,
      fee,
      isFirst,
      expiresAt,
      coins: repository.getUserStats(u, s)?.coins || 0,
    };
  }

  function openAttempt({ token, code, funConfig = {}, now = Date.now() }) {
    let attempt = null;
    let payload = null;
    const codeNorm = String(code || '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');

    // Código do RH é obrigatório (confirma que a pessoa leu a msg do grupo)
    if (!codeNorm || codeNorm.length < 4) {
      return { ok: false, reason: 'code-required' };
    }

    if (token) {
      const v = verifyJobToken(token, secretOf(funConfig), now);
      if (!v.ok) return { ok: false, reason: v.reason || 'bad-token' };
      payload = v.payload;
      attempt = jobRepository.getAttempt(payload.aid);
      if (!attempt) return { ok: false, reason: 'unknown-attempt' };
      if (attempt.tokenNonce && payload.nonce && attempt.tokenNonce !== payload.nonce) {
        return { ok: false, reason: 'nonce-mismatch' };
      }
      if (attempt.userJid !== payload.jid || attempt.scopeKey !== payload.scope) {
        return { ok: false, reason: 'identity-mismatch' };
      }
      if (String(attempt.code || '').toUpperCase() !== codeNorm) {
        return { ok: false, reason: 'code-mismatch' };
      }
    } else {
      attempt = jobRepository.getAttemptByCode(codeNorm);
      if (!attempt) return { ok: false, reason: 'unknown-code' };
    }

    if (attempt.status === 'passed' || attempt.status === 'failed') {
      return { ok: false, reason: 'already-finished', attempt };
    }
    if (attempt.expiresAt > 0 && now > attempt.expiresAt && attempt.status === 'pending') {
      jobRepository.finishAttempt({
        id: attempt.id,
        status: 'expired',
        now,
      });
      return { ok: false, reason: 'expired' };
    }

    if (attempt.status === 'pending') {
      attempt = jobRepository.markAttemptStarted(attempt.id, now);
    }

    const job = getJob(attempt.jobId);
    return {
      ok: true,
      attempt,
      job,
      game: job?.game,
      gameConfig: job?.gameConfig,
    };
  }

  /**
   * Valida score client-side de forma conservadora (MVP server-side).
   */
  function validateGameResult(job, { score, durationMs, metrics = {} }) {
    if (!job) return { ok: false, reason: 'unknown-job' };
    const cfg = job.gameConfig || {};
    const sc = Math.floor(Number(score) || 0);
    const dur = Math.floor(Number(durationMs) || 0);
    // firewall: 16×20s + folga; demais jogos usam durationMs do config
    const maxDur =
      job.game === 'firewall' || job.game === 'sequence'
        ? Math.max(
            (Number(cfg.durationMs) || 16 * 20_000) + 60_000,
            (Number(cfg.targetRounds) || 16) * (Number(cfg.portTimeMs) || 20_000) + 60_000
          )
        : (Number(cfg.durationMs) || 60_000) + 3_000;
    const maxScore = Number(cfg.maxScore) || 100;

    if (dur < 1_000) return { ok: false, reason: 'too-fast' };
    if (dur > maxDur) return { ok: false, reason: 'too-slow' };
    if (sc < 0 || sc > maxScore) return { ok: false, reason: 'score-invalid' };

    let passed = false;
    if (job.game === 'printer') {
      passed = sc >= (cfg.targetScore || 8) && (metrics.mistakes || 0) <= (cfg.maxMistakes || 3);
    } else if (job.game === 'fire') {
      passed =
        sc >= (cfg.targetScore || 20) &&
        (metrics.lostHouses || 0) <= (cfg.maxLostHouses || 3);
    } else if (job.game === 'firewall' || job.game === 'sequence') {
      // sequence = legado; firewall = teclado + ameaças laterais
      const need = cfg.targetRounds || cfg.targetScore || 16;
      const hits = Number(metrics.hits) || 0;
      const consec = Number(metrics.consecutiveMisses) || 0;
      const maxHits = Number(cfg.maxHits) || 3;
      const maxConsec = Number(cfg.maxConsecutiveMisses) || 3;
      passed =
        sc >= need &&
        hits < maxHits &&
        consec < maxConsec &&
        !metrics.timeout;
    } else {
      passed = sc >= (cfg.targetScore || 1);
    }

    return { ok: true, passed, score: sc, durationMs: dur };
  }

  function finishAttempt({
    attemptId,
    token,
    score,
    durationMs,
    metrics = {},
    funConfig = {},
    now = Date.now(),
  }) {
    let attempt = attemptId ? jobRepository.getAttempt(attemptId) : null;
    if (!attempt && token) {
      const v = verifyJobToken(token, secretOf(funConfig), now);
      if (!v.ok) return { ok: false, reason: v.reason || 'bad-token' };
      attempt = jobRepository.getAttempt(v.payload.aid);
    }
    if (!attempt) return { ok: false, reason: 'unknown-attempt' };
    if (attempt.status === 'passed' || attempt.status === 'failed') {
      return { ok: false, reason: 'already-finished', attempt };
    }
    if (!['pending', 'in_progress'].includes(attempt.status)) {
      return { ok: false, reason: 'bad-status', attempt };
    }

    const job = getJob(attempt.jobId);
    const check = validateGameResult(job, { score, durationMs, metrics });
    if (!check.ok) {
      const failed = jobRepository.finishAttempt({
        id: attempt.id,
        status: 'failed',
        score: Math.floor(Number(score) || 0),
        metrics: { ...metrics, reject: check.reason },
        now,
      });
      applyFailCooldown(attempt.userJid, attempt.scopeKey, attempt.jobId, now);
      return { ok: true, passed: false, reason: check.reason, attempt: failed, job };
    }

    if (check.passed) {
      // um cargo só — se já tiver, falha silenciosa (edge)
      const existing = jobRepository.getUserJob(attempt.userJid, attempt.scopeKey);
      if (existing?.jobId) {
        const failed = jobRepository.finishAttempt({
          id: attempt.id,
          status: 'failed',
          score: check.score,
          metrics: { ...metrics, reject: 'already-employed' },
          now,
        });
        return { ok: true, passed: false, reason: 'already-employed', attempt: failed, job };
      }
      jobRepository.setUserJob({
        userJid: attempt.userJid,
        scopeKey: attempt.scopeKey,
        jobId: job.id,
        now,
      });
      const done = jobRepository.finishAttempt({
        id: attempt.id,
        status: 'passed',
        score: check.score,
        metrics: { ...metrics, durationMs: check.durationMs },
        now,
      });
      const n = jobRepository.countInJob(attempt.scopeKey, job.id);
      return {
        ok: true,
        passed: true,
        attempt: done,
        job,
        salary: effectiveSalary(job, n),
        workers: n,
      };
    }

    const failed = jobRepository.finishAttempt({
      id: attempt.id,
      status: 'failed',
      score: check.score,
      metrics: { ...metrics, durationMs: check.durationMs },
      now,
    });
    applyFailCooldown(attempt.userJid, attempt.scopeKey, attempt.jobId, now);
    return { ok: true, passed: false, attempt: failed, job };
  }

  function applyFailCooldown(userJid, scopeKey, jobId, now = Date.now()) {
    const prev = jobRepository.getCooldown(userJid, scopeKey, jobId);
    const attemptCount = (prev?.attemptCount || 0) + 1;
    jobRepository.setCooldown({
      userJid,
      scopeKey,
      jobId,
      nextAttemptAt: now + WEEK_MS,
      attemptCount,
      now,
    });
  }

  function resign({ userJid, scopeKey }) {
    const job = jobRepository.getUserJob(userJid, scopeKey);
    if (!job?.jobId) return { ok: false, reason: 'not-employed' };
    jobRepository.clearUserJob(userJid, scopeKey);
    return { ok: true, previousJobId: job.jobId };
  }

  /**
   * Chamado no /daily: paga salário e reseta missed; se outro path detectar inatividade, demite.
   */
  function applyDailySalary({ userJid, scopeKey, now = Date.now() }) {
    const emp = getEmployment(userJid, scopeKey);
    if (!emp) return { paid: 0, job: null };

    jobRepository.resetMissedDaily(userJid, scopeKey, now);
    const amount = emp.salary;
    if (amount > 0) {
      repository.addCoins({
        userJid,
        scopeKey,
        amount,
        now,
        reason: `job-salary:${emp.jobId}`,
      });
    }
    return {
      paid: amount,
      job: emp.job,
      workers: emp.workers,
      coins: repository.getUserStats(userJid, scopeKey)?.coins || 0,
    };
  }

  /**
   * Inatividade: se last_daily_at antigo e tem emprego, incrementa missed.
   * Chamado ao tentar daily quando already-claimed? Melhor: tick em listagem.
   * Aqui: onMissedDailyWindow — se usuário não pegou daily em 24h+ desde last.
   */
  function processInactivity({ userJid, scopeKey, lastDailyAt, now = Date.now() }) {
    const emp = getEmployment(userJid, scopeKey);
    if (!emp) return { fired: false };
    const last = Number(lastDailyAt) || 0;
    // só processa se passou mais de ~1 dia sem daily após ter sido contratado
    if (last > 0 && now - last < 24 * 60 * 60_000) {
      return { fired: false };
    }
    // se hired_at é recente e nunca daily, não demite no primeiro dia
    if (last <= 0 && now - emp.hiredAt < 48 * 60 * 60_000) {
      return { fired: false };
    }

    const updated = jobRepository.incrementMissedDaily(userJid, scopeKey, now);
    if ((updated?.missedDailies || 0) >= INACTIVITY_MISSED) {
      jobRepository.clearUserJob(userJid, scopeKey);
      return { fired: true, jobId: emp.jobId, missed: updated.missedDailies };
    }
    return { fired: false, missed: updated?.missedDailies || 0 };
  }

  function formatJobList(scopeKey, userJid) {
    const rows = listWithMarket(scopeKey);
    const emp = userJid ? getEmployment(userJid, scopeKey) : null;
    const lines = [
      '💼 *Empregos do grupo*',
      '_Salário no `/daily` · teste no celular · falha é privada_',
      '',
    ];
    if (emp) {
      lines.push(
        `Seu cargo: ${emp.job.emoji} *${emp.job.name}* · ~*${emp.salary}*c/dia (${emp.workers} no cargo)`,
        '`/demitir sim` pra sair',
        ''
      );
    }
    for (const j of rows) {
      lines.push(
        `${j.emoji} *${j.id}* — base ${j.baseSalary}c → agora ~*${j.salary}*c/dia`,
        `   ${j.name} · ${j.workers} trabalhador(es) · teste *${j.difficulty}*`,
        `   ${j.description}`,
        ''
      );
    }
    lines.push('Candidatar: `/emprego bombeiro` · `/emprego estagiario` · `/emprego hacker`');
    lines.push('_1ª tentativa grátis · retentativa com taxa + CD 7 dias por cargo_');
    return lines.join('\n');
  }

  return {
    listWithMarket,
    getEmployment,
    startApplication,
    openAttempt,
    finishAttempt,
    validateGameResult,
    resign,
    applyDailySalary,
    processInactivity,
    formatJobList,
    checkCooldown,
    getJob,
    listJobs,
  };
}
