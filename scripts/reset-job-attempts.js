/**
 * Reseta tentativas de emprego falhas/pendentes e cooldowns.
 * NÃO remove quem já foi contratado (fun_user_jobs / status passed).
 *
 * Uso (banco do Fun):
 *   $env:TMB_DATA_DIR = (Resolve-Path data/fun).Path
 *   node scripts/reset-job-attempts.js
 *   node scripts/reset-job-attempts.js --dry-run
 *
 * Se TMB_DATA_DIR não estiver setado e existir data/fun/, usa data/fun automaticamente.
 */
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const funData = path.join(root, 'data', 'fun');

if (!String(process.env.TMB_DATA_DIR || '').trim() && fs.existsSync(funData)) {
  process.env.TMB_DATA_DIR = funData;
  console.log('[reset-job-attempts] TMB_DATA_DIR →', funData);
}

const dryRun = process.argv.includes('--dry-run');

await initDb();
const db = getDb();
console.log('[reset-job-attempts] data dir:', process.env.TMB_DATA_DIR || '(default data/)');

const before = {
  attempts: db
    .prepare(
      `SELECT status, COUNT(*) AS c FROM analytics.fun_job_attempts GROUP BY status ORDER BY status`
    )
    .all(),
  cooldowns: db.prepare(`SELECT COUNT(*) AS c FROM analytics.fun_job_cooldowns`).get()?.c || 0,
  employed: db.prepare(`SELECT COUNT(*) AS c FROM analytics.fun_user_jobs`).get()?.c || 0,
  practiceUsed: db
    .prepare(
      `SELECT COUNT(*) AS c FROM analytics.fun_job_attempts WHERE COALESCE(practice_used, 0) > 0`
    )
    .get()?.c || 0,
};

console.log('[reset-job-attempts] antes:', JSON.stringify(before, null, 2));
console.log(dryRun ? '[reset-job-attempts] DRY-RUN — nada será gravado' : '[reset-job-attempts] aplicando…');

if (!dryRun) {
  const tx = db.transaction(() => {
    // 1) Zera CD de todos os cargos (quem falhou pode tentar de novo sem esperar 7 dias)
    const cd = db.prepare(`DELETE FROM analytics.fun_job_cooldowns`).run();

    // 2) Remove tentativas que NÃO passaram (failed / expired / pending / in_progress)
    //    Assim countPriorAttempts volta a 0 → 1ª tentativa grátis de novo.
    //    Mantém 'passed' (histórico de contratação).
    const del = db
      .prepare(
        `DELETE FROM analytics.fun_job_attempts
         WHERE status IS NULL OR status NOT IN ('passed')`
      )
      .run();

    return { cooldownsDeleted: cd.changes, attemptsDeleted: del.changes };
  });

  const result = tx();
  console.log('[reset-job-attempts] resultado:', result);
}

const after = {
  attempts: db
    .prepare(
      `SELECT status, COUNT(*) AS c FROM analytics.fun_job_attempts GROUP BY status ORDER BY status`
    )
    .all(),
  cooldowns: db.prepare(`SELECT COUNT(*) AS c FROM analytics.fun_job_cooldowns`).get()?.c || 0,
  employed: db.prepare(`SELECT COUNT(*) AS c FROM analytics.fun_user_jobs`).get()?.c || 0,
};

console.log('[reset-job-attempts] depois:', JSON.stringify(after, null, 2));
console.log('[reset-job-attempts] empregos ativos preservados:', after.employed);
