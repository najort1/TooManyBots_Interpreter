/**
 * Migração incremental de identidade PN → LID para Baileys v7.
 *
 * O WhatsApp passa a entregar LIDs como identidade principal. Quando o
 * Baileys informa o par LID/PN, movemos os valores legados de PN para LID em
 * uma única transação. A migração é estritamente conservadora: se já houver
 * um registro LID no mesmo campo, ela não escolhe qual dos dois venceria.
 */

import { getDb } from '../db/index.js';

const ALIAS_TABLE = 'lid_identity_aliases';

function quoteIdentifier(value) {
  return `"${String(value || '').replace(/"/g, '""')}"`;
}

function normalizeLidJid(value) {
  const jid = String(value || '').trim();
  if (!jid) return '';
  if (jid.endsWith('@lid')) return jid;
  const [local, domain] = jid.split('@');
  if (domain === 's.whatsapp.net' && /^\d{10,20}$/.test(local || '')) return `${local}@lid`;
  return '';
}

function normalizePnJid(value) {
  const jid = String(value || '').trim();
  if (!jid.endsWith('@s.whatsapp.net')) return '';
  const local = jid.slice(0, -'@s.whatsapp.net'.length);
  return /^\d{8,20}$/.test(local) ? jid : '';
}

function isMigratableJidColumn(columnName) {
  const name = String(columnName || '').toLowerCase();
  return name === 'jid' || name.endsWith('_jid') || name === 'scope_key' || name === 'preferred_scope_key';
}

function isMigratableJsonColumn(columnName) {
  const name = String(columnName || '').toLowerCase();
  return name.endsWith('_json') || name === 'metadata' || name.endsWith('_metadata');
}

function listTables(db, schema) {
  return db
    .prepare(
      `SELECT name FROM ${schema}.sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> ?`
    )
    .all(ALIAS_TABLE)
    .map((row) => String(row?.name || ''))
    .filter(Boolean);
}

function listColumns(db, schema, table) {
  const rows = db.prepare(`PRAGMA ${schema}.table_info(${quoteIdentifier(table)})`).all();
  return rows.map((row) => String(row?.name || '')).filter(Boolean);
}

function migrateJidColumn(db, schema, table, column, pnJid, lidJid, conflicts) {
  const target = `${schema}.${quoteIdentifier(table)}`;
  const col = quoteIdentifier(column);
  const counts = db
    .prepare(
      `SELECT
         SUM(CASE WHEN ${col} = ? THEN 1 ELSE 0 END) AS legacy_count,
         SUM(CASE WHEN ${col} = ? THEN 1 ELSE 0 END) AS lid_count
       FROM ${target}`
    )
    .get(pnJid, lidJid);
  const legacyCount = Number(counts?.legacy_count) || 0;
  const lidCount = Number(counts?.lid_count) || 0;
  if (legacyCount === 0) return 0;
  if (lidCount > 0) {
    conflicts.push({ schema, table, column, reason: 'target-already-exists', legacyCount, lidCount });
    return 0;
  }
  const result = db.prepare(`UPDATE ${target} SET ${col} = ? WHERE ${col} = ?`).run(lidJid, pnJid);
  return Number(result?.changes) || 0;
}

function migrateJsonColumn(db, schema, table, column, pnJid, lidJid) {
  const target = `${schema}.${quoteIdentifier(table)}`;
  const col = quoteIdentifier(column);
  // Substitui apenas o JID completo dentro de campos JSON. Como PN e LID são
  // strings, REPLACE preserva a validade do JSON e também cobre arrays/chaves.
  const result = db
    .prepare(`UPDATE ${target} SET ${col} = REPLACE(${col}, ?, ?) WHERE INSTR(${col}, ?) > 0`)
    .run(pnJid, lidJid, pnJid);
  return Number(result?.changes) || 0;
}

function ensureAliasSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${ALIAS_TABLE} (
      lid_jid TEXT PRIMARY KEY,
      pn_jid TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
}

/**
 * @param {{ getDatabase?: () => import('better-sqlite3').Database, getLogger?: () => object|null }} deps
 */
export function createLidIdentityMigrationService({ getDatabase = getDb, getLogger = () => null } = {}) {
  function migratePair({ lid, pn, now = Date.now() } = {}) {
    const lidJid = normalizeLidJid(lid);
    const pnJid = normalizePnJid(pn);
    if (!lidJid || !pnJid) return { ok: false, reason: 'invalid-mapping', migratedRows: 0, conflicts: [] };
    if (lidJid === pnJid) return { ok: true, reason: 'same-identity', migratedRows: 0, conflicts: [] };

    const db = getDatabase();
    ensureAliasSchema(db);
    const timestamp = Number(now) || Date.now();
    const conflicts = [];
    let migratedRows = 0;

    const migrate = db.transaction(() => {
      const aliasForPn = db.prepare(`SELECT lid_jid FROM ${ALIAS_TABLE} WHERE pn_jid = ?`).get(pnJid);
      if (aliasForPn && String(aliasForPn.lid_jid) !== lidJid) {
        conflicts.push({ schema: 'main', table: ALIAS_TABLE, column: 'pn_jid', reason: 'pn-already-mapped' });
        return;
      }

      const aliasForLid = db.prepare(`SELECT pn_jid FROM ${ALIAS_TABLE} WHERE lid_jid = ?`).get(lidJid);
      if (aliasForLid && String(aliasForLid.pn_jid) !== pnJid) {
        conflicts.push({ schema: 'main', table: ALIAS_TABLE, column: 'lid_jid', reason: 'lid-already-mapped' });
        return;
      }

      db.prepare(
        `INSERT INTO ${ALIAS_TABLE}(lid_jid, pn_jid, created_at, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(lid_jid) DO UPDATE SET updated_at = excluded.updated_at`
      ).run(lidJid, pnJid, timestamp, timestamp);

      for (const schema of ['main', 'analytics']) {
        for (const table of listTables(db, schema)) {
          const columns = listColumns(db, schema, table);
          for (const column of columns.filter(isMigratableJidColumn)) {
            migratedRows += migrateJidColumn(db, schema, table, column, pnJid, lidJid, conflicts);
          }
          for (const column of columns.filter(isMigratableJsonColumn)) {
            migratedRows += migrateJsonColumn(db, schema, table, column, pnJid, lidJid);
          }
        }
      }
    });

    try {
      migrate();
    } catch (error) {
      getLogger?.()?.warn?.(
        { err: String(error?.message || error), lidJid, pnJid },
        'lid identity migration failed'
      );
      return { ok: false, reason: 'migration-failed', migratedRows: 0, conflicts, error: String(error?.message || error) };
    }

    return {
      ok: conflicts.length === 0,
      reason: conflicts.length ? 'conflict' : 'migrated',
      lidJid,
      pnJid,
      migratedRows,
      conflicts,
    };
  }

  return { migratePair };
}
