/**
 * Reseta preços do mercado para base (ou clamp no teto da personalidade).
 * Uso: node fun/scripts/reset-market-prices.mjs [--soft]
 *   default: price = basePrice
 *   --soft: só clampa ao [floor, ceil] da personalidade
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { COLLECTIBLES } from '../shop/collectibles.js';
import { companyForItem } from '../economy/companies.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const soft = process.argv.includes('--soft');
const now = Date.now();

const candidates = [
  path.join(root, 'data/fun/analytics.db'),
  path.join(root, 'data/analytics.db'),
];

function openDb(file) {
  if (!fs.existsSync(file)) return null;
  const db = new Database(file);
  // tenta schema analytics attached ou main
  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
    .all()
    .map((r) => r.name);
  const hasMain = tables.includes('fun_market_prices');
  // better-sqlite3: attached schemas?
  let prefix = '';
  try {
    const att = db.prepare(`PRAGMA database_list`).all();
    for (const a of att) {
      try {
        const n = db
          .prepare(
            `SELECT COUNT(*) AS c FROM ${a.name}.fun_market_prices`
          )
          .get();
        if (n && Number(n.c) >= 0) {
          return { db, schema: a.name, file };
        }
      } catch {
        /* try next */
      }
    }
  } catch {
    /* */
  }
  if (hasMain) return { db, schema: 'main', file };
  db.close();
  return null;
}

function targetPrice(item) {
  const persona = companyForItem(item);
  const base = Math.max(1, Math.floor(item.basePrice));
  if (!soft) return base;
  return base; // soft still used only for clamp of existing
}

function clampToPersona(price, item) {
  const persona = companyForItem(item);
  const base = Math.max(1, Math.floor(item.basePrice));
  const floor = Math.max(1, Math.floor(base * (persona.floorMult || 0.4)));
  const ceil = Math.max(floor + 1, Math.floor(base * (persona.ceilMult || 2.2)));
  return Math.min(ceil, Math.max(floor, Math.floor(Number(price) || base)));
}

let any = false;
for (const file of candidates) {
  const opened = openDb(file);
  if (!opened) {
    console.log('skip (no market table):', file);
    continue;
  }
  any = true;
  const { db, schema } = opened;
  const q = (sql) => sql.replaceAll('__S__', schema);

  const rows = db
    .prepare(q(`SELECT scope_key, item_id, price, previous_price FROM __S__.fun_market_prices`))
    .all();

  console.log(`\n${file} (schema=${schema}) — ${rows.length} preços`);

  const byItem = new Map(COLLECTIBLES.map((c) => [c.id, c]));
  const upd = db.prepare(
    q(
      `UPDATE __S__.fun_market_prices
       SET price = ?, previous_price = ?, trend = 'flat', updated_at = ?
       WHERE scope_key = ? AND item_id = ?`
    )
  );
  const resetState = db.prepare(
    q(
      `UPDATE __S__.fun_market_asset_state
       SET supply = 1, demand = 1, event_shock = 0, volume_buy = 0, volume_sell = 0, updated_at = ?
       WHERE scope_key = ? AND item_id = ?`
    )
  );

  const tx = db.transaction(() => {
    let n = 0;
    for (const r of rows) {
      const item = byItem.get(r.item_id);
      if (!item) continue;
      const prev = Number(r.price) || item.basePrice;
      let next = soft ? clampToPersona(prev, item) : targetPrice(item);
      if (next === prev && soft) continue;
      upd.run(next, prev, now, r.scope_key, r.item_id);
      try {
        resetState.run(now, r.scope_key, r.item_id);
      } catch {
        /* asset_state pode não existir em DB velho */
      }
      if (prev !== next) {
        console.log(
          `  ${String(r.scope_key).slice(0, 18)}… ${r.item_id}: ${prev} → ${next} (base ${item.basePrice})`
        );
        n++;
      }
    }
    // limpa overheat do regulador se existir economy_json
    try {
      const metas = db.prepare(q(`SELECT scope_key, economy_json FROM __S__.fun_market_meta`)).all();
      const um = db.prepare(
        q(`UPDATE __S__.fun_market_meta SET economy_json = ?, updated_at = ? WHERE scope_key = ?`)
      );
      for (const m of metas) {
        let eco = {};
        try {
          eco = JSON.parse(m.economy_json || '{}') || {};
        } catch {
          eco = {};
        }
        eco.marketOverheat = 0;
        eco.recentArchetypes = [];
        eco.scheduledShocks = [];
        eco.narrativeSeeds = ['soft_recovery'];
        um.run(JSON.stringify(eco), now, m.scope_key);
      }
    } catch {
      /* */
    }
    return n;
  });

  const changed = tx();
  console.log(`  alterados: ${changed}`);
  db.close();
}

if (!any) {
  console.error('Nenhum analytics.db com fun_market_prices encontrado.');
  process.exit(1);
}
console.log('\nOK — reinicie o bot Fun se estiver rodando.');
