/**
 * Remove usuários/attempts gerados por gen-job-test-links.mjs
 * (JIDs 5511999…@s.whatsapp.net e reason seed-test).
 *
 * Uso: node fun/scripts/cleanup-job-test-data.mjs
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

const dataDir = resolveDataDir();
process.env.TMB_DATA_DIR = dataDir;
fs.mkdirSync(dataDir, { recursive: true });

const { initDb } = await import('../../db/index.js');
const { getDb } = await import('../../db/context.js');

await initDb();
const db = getDb();

// Padrão do script de teste
const TEST_JID_LIKE = '5511999%@s.whatsapp.net';

function count(sql, param) {
  try {
    return Number(db.prepare(sql).get(param)?.c) || 0;
  } catch {
    return 0;
  }
}

const before = {
  stats: count(
    `SELECT COUNT(*) AS c FROM analytics.fun_user_stats WHERE user_jid LIKE ?`,
    TEST_JID_LIKE
  ),
  attempts: count(
    `SELECT COUNT(*) AS c FROM analytics.fun_job_attempts WHERE user_jid LIKE ?`,
    TEST_JID_LIKE
  ),
  jobs: count(
    `SELECT COUNT(*) AS c FROM analytics.fun_user_jobs WHERE user_jid LIKE ?`,
    TEST_JID_LIKE
  ),
  cooldowns: count(
    `SELECT COUNT(*) AS c FROM analytics.fun_job_cooldowns WHERE user_jid LIKE ?`,
    TEST_JID_LIKE
  ),
};

console.log('Banco:', dataDir);
console.log('Antes:', before);

const run = db.transaction(() => {
  const del = (sql) => {
    try {
      return db.prepare(sql).run(TEST_JID_LIKE).changes;
    } catch (e) {
      console.warn('skip', sql, e.message);
      return 0;
    }
  };

  // ordem: filhos → stats
  const changes = {
    attempts: del(`DELETE FROM analytics.fun_job_attempts WHERE user_jid LIKE ?`),
    cooldowns: del(`DELETE FROM analytics.fun_job_cooldowns WHERE user_jid LIKE ?`),
    jobs: del(`DELETE FROM analytics.fun_user_jobs WHERE user_jid LIKE ?`),
    // inventário / bazar / efeitos / ações se existirem com o mesmo jid
    inventory: del(`DELETE FROM analytics.fun_inventory WHERE user_jid LIKE ?`),
    effects: del(`DELETE FROM analytics.fun_user_effects WHERE user_jid LIKE ?`),
    actions: del(`DELETE FROM analytics.fun_user_actions WHERE user_jid LIKE ?`),
    stats: del(`DELETE FROM analytics.fun_user_stats WHERE user_jid LIKE ?`),
  };

  // limpa attempts órfãos de gen (códigos recentes sem user válido) — só jids de teste
  return changes;
});

const changes = run();
console.log('Removido:', changes);

const after = {
  stats: count(
    `SELECT COUNT(*) AS c FROM analytics.fun_user_stats WHERE user_jid LIKE ?`,
    TEST_JID_LIKE
  ),
  attempts: count(
    `SELECT COUNT(*) AS c FROM analytics.fun_job_attempts WHERE user_jid LIKE ?`,
    TEST_JID_LIKE
  ),
};
console.log('Depois:', after);
console.log('OK — usuários de teste 5511999* limpos.');
