/**
 * Força reabastecimento imediato do estoque em todos os grupos.
 * Uso: node fun/scripts/force-restock.mjs
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { COLLECTIBLES } from '../shop/collectibles.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const now = Date.now();

const candidates = [
  path.join(root, 'data/fun/analytics.db'),
  path.join(root, 'data/analytics.db'),
];

function openDb(file) {
  if (!fs.existsSync(file)) return null;
  const db = new Database(file);
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map(r => r.name);
  if (tables.includes('fun_market_stock')) return { db, schema: 'main', file };
  // attached analytics schema
  try {
    const att = db.prepare(`PRAGMA database_list`).all();
    for (const a of att) {
      try {
        const n = db.prepare(`SELECT COUNT(*) AS c FROM ${a.name}.fun_market_stock`).get();
        if (n && Number(n.c) >= 0) return { db, schema: a.name, file };
      } catch { /* try next */ }
    }
  } catch { /* */ }
  db.close();
  return null;
}

let any = false;
for (const file of candidates) {
  const opened = openDb(file);
  if (!opened) {
    console.log('skip (no market stock table):', file);
    continue;
  }
  any = true;
  const { db, schema } = opened;
  const q = (sql) => sql.replaceAll('__S__', schema);

  // Lista scope_keys distintos
  const scopes = db.prepare(q(`SELECT DISTINCT scope_key FROM __S__.fun_market_stock`)).all().map(r => r.scope_key);
  // Também pega de fun_market_meta (grupos que nunca compraram mas existem)
  const metaScopes = db.prepare(q(`SELECT DISTINCT scope_key FROM __S__.fun_market_meta`)).all().map(r => r.scope_key);
  const allScopes = [...new Set([...scopes, ...metaScopes])].filter(Boolean);

  if (allScopes.length === 0) {
    console.log(`nenhum scope_key encontrado em ${file}`);
    continue;
  }

  console.log(`\n${file} (schema=${schema}) — ${allScopes.length} grupos encontrados`);

  const upsertStock = db.prepare(
    q(`INSERT INTO __S__.fun_market_stock (scope_key, item_id, stock, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(scope_key, item_id) DO UPDATE SET
         stock = excluded.stock,
         updated_at = excluded.updated_at`)
  );

  const upsertMeta = db.prepare(
    q(`INSERT INTO __S__.fun_market_meta
       (scope_key, last_event_at, next_event_at, last_restock_at, updated_at, economy_json, last_economy_tick_at)
       VALUES (?, 0, 0, ?, ?, '{}', 0)
       ON CONFLICT(scope_key) DO UPDATE SET
         last_restock_at = excluded.last_restock_at,
         updated_at = excluded.updated_at`)
  );

  let totalItems = 0;
  const tx = db.transaction(() => {
    for (const scope of allScopes) {
      for (const item of COLLECTIBLES) {
        const stock = Math.max(0, Math.floor(Number(item.stockMax) || 0));
        upsertStock.run(scope, item.id, stock, now);
        totalItems++;
      }
      upsertMeta.run(scope, now, now);
    }
  });
  tx();

  console.log(`✓ ${allScopes.length} grupos reabastecidos (${totalItems} itens no total)`);
  db.close();
}

if (!any) {
  console.log('Nenhum banco de dados com estoque encontrado.');
  process.exit(1);
}
