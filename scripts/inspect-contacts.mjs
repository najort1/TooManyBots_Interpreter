import Database from 'better-sqlite3';

for (const f of ['data/analytics.db', 'data/fun/analytics.db', 'data/runtime.db', 'data/fun/runtime.db']) {
  try {
    const db = new Database(f, { readonly: true });
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%contact%'").all();
    console.log(f, JSON.stringify(tables));
    if (tables.length) {
      const rows = db.prepare('SELECT jid, display_name, source, updated_at FROM contact_profiles ORDER BY updated_at DESC LIMIT 50').all();
      for (const r of rows) {
        console.log(' ', r.jid, JSON.stringify(r.display_name), r.source, new Date(r.updated_at).toISOString());
      }
    }
    db.close();
  } catch (e) {
    console.log(f, 'ERR', e.message);
  }
}
