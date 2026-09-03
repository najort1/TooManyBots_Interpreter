import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import { createLidIdentityMigrationService } from '../runtime/lidIdentityMigration.js';

await initDb();

function uniqueTable(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

test('migração LID move referências PN em colunas de identidade sem perder o alias', () => {
  const db = getDb();
  const table = uniqueTable('lid_identity_rows');
  const pn = '558199999888@s.whatsapp.net';
  const lid = '281350775005409@lid';
  db.exec(`CREATE TABLE "${table}" (owner_jid TEXT, partner_jid TEXT, scope_key TEXT, members_json TEXT)`);
  db.prepare(`INSERT INTO "${table}" VALUES (?, ?, ?, ?)`).run(pn, pn, pn, JSON.stringify({ members: [pn] }));

  const migration = createLidIdentityMigrationService({ getDatabase: getDb });
  const result = migration.migratePair({ lid, pn, now: 123 });

  assert.deepEqual(result, {
    ok: true,
    reason: 'migrated',
    lidJid: lid,
    pnJid: pn,
    migratedRows: 4,
    conflicts: [],
  });
  assert.deepEqual(db.prepare(`SELECT * FROM "${table}"`).get(), {
    owner_jid: lid,
    partner_jid: lid,
    scope_key: lid,
    members_json: JSON.stringify({ members: [lid] }),
  });
  assert.deepEqual(
    db.prepare('SELECT lid_jid, pn_jid FROM lid_identity_aliases WHERE lid_jid = ?').get(lid),
    { lid_jid: lid, pn_jid: pn }
  );
});

test('migração LID não escolhe silenciosamente entre registros PN e LID conflitantes', () => {
  const db = getDb();
  const table = uniqueTable('lid_identity_conflict');
  const pn = '5581977776666@s.whatsapp.net';
  const lid = '333333333333333@lid';
  db.exec(`CREATE TABLE "${table}" (owner_jid TEXT)`);
  db.prepare(`INSERT INTO "${table}" VALUES (?), (?)`).run(pn, lid);

  const migration = createLidIdentityMigrationService({ getDatabase: getDb });
  const result = migration.migratePair({ lid, pn, now: 456 });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'conflict');
  assert.deepEqual(result.conflicts, [{
    schema: 'main',
    table,
    column: 'owner_jid',
    reason: 'target-already-exists',
    legacyCount: 1,
    lidCount: 1,
  }]);
  assert.deepEqual(
    db.prepare(`SELECT owner_jid FROM "${table}" ORDER BY owner_jid`).all(),
    [{ owner_jid: lid }, { owner_jid: pn }]
  );
});
