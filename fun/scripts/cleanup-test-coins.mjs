/**
 * Remove contas de teste (5000 coins, sem atividade) de um grupo.
 * Uso: node fun/scripts/cleanup-test-coins.mjs 120363390006674987
 *      node fun/scripts/cleanup-test-coins.mjs 120363390006674987 --dry-run
 */
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const groupArg = (process.argv[2] || '120363390006674987').replace(/@g\.us$/i, '');
const dryRun = process.argv.includes('--dry-run');
const scope = `${groupArg}@g.us`;
const dbPath = path.join(root, 'data', 'fun', 'analytics.db');

if (!fs.existsSync(dbPath)) {
  console.error('DB não encontrada:', dbPath);
  process.exit(1);
}

const db = new Database(dbPath);

const targets = db
  .prepare(
    `SELECT user_jid, coins, xp, level, message_count
     FROM fun_user_stats
     WHERE scope_key = ?
       AND coins = 5000
       AND COALESCE(xp, 0) = 0
       AND COALESCE(message_count, 0) = 0
     ORDER BY user_jid`
  )
  .all(scope);

console.log(`Grupo: ${scope}`);
console.log(`Alvos (5000c · 0xp · 0msgs): ${targets.length}`);
for (const t of targets) {
  console.log(`  ${t.user_jid}  coins=${t.coins}`);
}

if (!targets.length) {
  console.log('Nada a limpar.');
  db.close();
  process.exit(0);
}

if (dryRun) {
  console.log('[dry-run] nenhuma alteração.');
  db.close();
  process.exit(0);
}

const jids = targets.map((t) => t.userJid || t.user_jid);
const placeholders = jids.map(() => '?').join(',');

const run = db.transaction(() => {
  const deleted = {};

  // stats (ranking coins/xp)
  deleted.stats = db
    .prepare(
      `DELETE FROM fun_user_stats
       WHERE scope_key = ? AND user_jid IN (${placeholders})`
    )
    .run(scope, ...jids).changes;

  // ledger / efeitos / inventário / stocks se existirem
  const optional = [
    'fun_coin_ledger',
    'fun_user_effects',
    'fun_inventory',
    'fun_stock_holdings',
    'fun_stock_trade_meta',
    'fun_user_profiles',
    'fun_user_jobs',
    'fun_job_attempts',
    'fun_job_cooldowns',
    'fun_casino_stats',
    'fun_user_prefs',
  ];

  for (const table of optional) {
    try {
      const cols = db.prepare(`PRAGMA table_info(${table})`).all();
      const names = new Set(cols.map((c) => c.name));
      if (!names.has('user_jid') || !names.has('scope_key')) {
        // ledger uses from_jid/to_jid
        if (table === 'fun_coin_ledger' && names.has('scope_key')) {
          deleted[table] = db
            .prepare(
              `DELETE FROM fun_coin_ledger
               WHERE scope_key = ?
                 AND (from_jid IN (${placeholders}) OR to_jid IN (${placeholders}))`
            )
            .run(scope, ...jids, ...jids).changes;
        }
        continue;
      }
      deleted[table] = db
        .prepare(
          `DELETE FROM ${table}
           WHERE scope_key = ? AND user_jid IN (${placeholders})`
        )
        .run(scope, ...jids).changes;
    } catch (e) {
      // tabela pode não existir
      deleted[table] = `skip:${e.message}`;
    }
  }

  return deleted;
});

const result = run();
console.log('Removido:', result);

const top = db
  .prepare(
    `SELECT user_jid, coins, xp, message_count
     FROM fun_user_stats
     WHERE scope_key = ?
     ORDER BY coins DESC
     LIMIT 5`
  )
  .all(scope);

console.log('\nNovo top coins:');
for (const r of top) {
  console.log(`  ${r.coins}\t${r.user_jid}\txp=${r.xp}\tmsgs=${r.message_count}`);
}

db.close();
console.log(dryRun ? 'dry-run ok' : 'OK — ranking limpo.');
