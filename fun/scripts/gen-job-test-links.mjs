/**
 * Gera links + códigos de teste dos 3 empregos no banco do Fun (data/fun).
 * Uso: node fun/scripts/gen-job-test-links.mjs
 *
 * OBRIGATÓRIO: setar TMB_DATA_DIR antes de importar db/* (igual fun/start.js).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FUN_DIR = path.resolve(__dirname, '..');
const FUN_USER_CONFIG_PATH = path.join(FUN_DIR, 'config.user.json');
const FUN_DEFAULT_DATA_DIR = path.resolve(FUN_DIR, '..', 'data', 'fun');

function resolveDataDir() {
  if (process.env.TMB_DATA_DIR) {
    return path.resolve(String(process.env.TMB_DATA_DIR).trim());
  }
  if (fs.existsSync(FUN_USER_CONFIG_PATH)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(FUN_USER_CONFIG_PATH, 'utf-8'));
      const custom = String(parsed?.dataDir ?? '').trim();
      if (custom) return path.resolve(custom);
    } catch {
      // ignore
    }
  }
  return FUN_DEFAULT_DATA_DIR;
}

// ANTES de qualquer import de db
const dataDir = resolveDataDir();
process.env.TMB_DATA_DIR = dataDir;
fs.mkdirSync(dataDir, { recursive: true });

const { initDb } = await import('../../db/index.js');
const { getDb } = await import('../../db/context.js');
const { createFunStatsRepository } = await import('../db/funStatsRepository.js');
const { createFunJobRepository } = await import('../db/funJobRepository.js');
const { createJobService } = await import('../services/jobService.js');
const { resolveFunConfig, loadFunUserConfig } = await import('../config.js');
const { getPublicBaseUrl, clearPublicUrlCache } = await import('../utils/publicUrl.js');
const { listJobs } = await import('../jobs/catalog.js');

await initDb();

const userCfg = loadFunUserConfig();
const funConfig = resolveFunConfig({
  ...userCfg,
  jobLinkTtlMs: 24 * 60 * 60_000,
  jobTokenSecret: userCfg.jobTokenSecret || 'fun-job-dev-secret-change-me',
});

clearPublicUrlCache();
const base = getPublicBaseUrl(funConfig, { force: true });

const repo = createFunStatsRepository({ getDatabase: getDb });
repo.ensureFunSchema();
const jobRepo = createFunJobRepository({ getDatabase: getDb });
const jobs = createJobService({ repository: repo, jobRepository: jobRepo });

const whitelist = Array.isArray(userCfg.groupWhitelistJids) ? userCfg.groupWhitelistJids : [];
const scope = String(whitelist[0] || '120363405600887559@g.us');
const tester = `5511999${String(Date.now()).slice(-7)}@s.whatsapp.net`;
repo.addCoins({ userJid: tester, scopeKey: scope, amount: 5000, reason: 'seed-test' });

// sanity: attempts table exists in THIS db
const db = getDb();
const tables = db
  .prepare(
    `SELECT name FROM analytics.sqlite_master WHERE type='table' AND name='fun_job_attempts'`
  )
  .all();
if (!tables.length) {
  console.error('ERRO: fun_job_attempts não existe em', dataDir);
  process.exit(1);
}

console.log('\n=== LINKS DE TESTE DOS EMPREGOS ===\n');
console.log(`Banco Fun:    ${dataDir}`);
console.log(`Base pública: ${base}`);
console.log(`Tester jid:   ${tester}`);
console.log(`Grupo scope:  ${scope}`);
console.log(`TTL:          24h\n`);
console.log('Precisa: fun rodando (API 8790) + Next (3001) + cloudflared → 3001\n');

const secret = funConfig.jobTokenSecret || 'fun-job-dev-secret-change-me';
console.log(`Token secret: ${secret.slice(0, 8)}…\n`);

for (const job of listJobs()) {
  jobRepo.clearUserJob(tester, scope);
  jobRepo.setCooldown({
    userJid: tester,
    scopeKey: scope,
    jobId: job.id,
    nextAttemptAt: 0,
    attemptCount: 0,
  });

  const app = jobs.startApplication({
    userJid: tester,
    scopeKey: scope,
    jobId: job.id,
    funConfig,
  });

  if (!app.ok) {
    console.log(`❌ ${job.id}: ${app.reason}`);
    continue;
  }

  // verify
  const row = jobRepo.getAttempt(app.attempt.id);
  if (!row) {
    console.log(`❌ ${job.id}: attempt não persistiu no DB!`);
    continue;
  }

  console.log(`--- ${job.emoji} ${job.name} (${job.id}) ---`);
  console.log(`Attempt: ${app.attempt.id}`);
  console.log(`Código:  ${app.code}`);
  console.log(`Link:\n${app.link}\n`);
}

console.log('Abra no celular. Se der unknown-attempt: reinicie o fun (mesma dataDir) e confira secret.\n');
