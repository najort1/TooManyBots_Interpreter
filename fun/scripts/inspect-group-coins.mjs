import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const group = (process.argv[2] || '120363390006674987').replace(/@g\.us$/i, '');
const scope = `${group}@g.us`;

const candidates = [
  path.join(root, 'data', 'fun', 'analytics.db'),
  path.join(root, 'data', 'analytics.db'),
];

for (const p of candidates) {
  if (!fs.existsSync(p)) {
    console.log('missing', p);
    continue;
  }
  console.log('\n===', p, '===');
  const db = new Database(p, { readonly: true });
  try {
    // try analytics schema attach pattern used by app
    const tables = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%user_stat%'`
      )
      .all();
    console.log('tables', tables);

    let rows = [];
    try {
      rows = db
        .prepare(
          `SELECT user_jid, coins, xp, level, message_count, title
           FROM fun_user_stats
           WHERE scope_key = ? OR scope_key = ?
           ORDER BY coins DESC LIMIT 20`
        )
        .all(scope, group);
    } catch (e) {
      console.log('query main failed', e.message);
    }

    // also search any scope containing the id
    try {
      const scopes = db
        .prepare(
          `SELECT scope_key, COUNT(*) n, MAX(coins) max_coins
           FROM fun_user_stats
           WHERE scope_key LIKE ?
           GROUP BY scope_key`
        )
        .all(`%${group}%`);
      console.log('scopes match', scopes);
    } catch (e) {
      console.log('scopes fail', e.message);
    }

    if (!rows.length) {
      try {
        rows = db
          .prepare(
            `SELECT user_jid, coins, xp, level, message_count, title, scope_key
             FROM fun_user_stats
             WHERE scope_key LIKE ?
             ORDER BY coins DESC LIMIT 20`
          )
          .all(`%${group}%`);
      } catch (e) {
        console.log('like query fail', e.message);
      }
    }

    console.log('top rows', rows.length);
    for (const r of rows) {
      console.log(
        `${r.coins}\t${r.user_jid}\txp=${r.xp}\tlv=${r.level}\tmsgs=${r.message_count}\tscope=${r.scope_key || scope}`
      );
    }

    // 5000 exact
    try {
      const fives = db
        .prepare(
          `SELECT user_jid, coins, scope_key FROM fun_user_stats
           WHERE (scope_key LIKE ?) AND coins = 5000`
        )
        .all(`%${group}%`);
      console.log('exactly 5000:', fives);
    } catch (e) {
      console.log('5000 query fail', e.message);
    }
  } finally {
    db.close();
  }
}
