import { getDb } from '../../db/context.js';
import { ensureFunSchema as applyFunSchema } from '../schema.js';

const ANALYTICS_SCHEMA = 'analytics';

export function createFunRelationshipRepository({ getDatabase = getDb } = {}) {
  function ensureSchema() {
    applyFunSchema(getDatabase());
  }

  function getMarriage(userJid, scopeKey) {
    ensureSchema();
    const db = getDatabase();
    const row = db
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_marriages
         WHERE scope_key = ? AND user_jid = ?`
      )
      .get(String(scopeKey || ''), String(userJid || ''));
    if (!row) return null;
    return {
      scopeKey: String(row.scope_key || ''),
      userJid: String(row.user_jid || ''),
      partnerJid: String(row.partner_jid || ''),
      marriedAt: Number(row.married_at) || 0,
    };
  }

  /**
   * Casa dois usuários no scope. Ambos devem estar livres.
   */
  function marry({ userJid, partnerJid, scopeKey, now = Date.now() }) {
    ensureSchema();
    const db = getDatabase();
    const a = String(userJid || '').trim();
    const b = String(partnerJid || '').trim();
    const s = String(scopeKey || '').trim();
    const ts = Number(now) || Date.now();

    if (!a || !b || !s) return { ok: false, reason: 'invalid-identity' };
    if (a === b) return { ok: false, reason: 'self-marry' };

    const run = db.transaction(() => {
      const aM = getMarriage(a, s);
      const bM = getMarriage(b, s);
      if (aM) return { ok: false, reason: 'already-married', partnerJid: aM.partnerJid };
      if (bM) return { ok: false, reason: 'partner-married', partnerJid: bM.partnerJid };

      const insert = db.prepare(
        `INSERT INTO ${ANALYTICS_SCHEMA}.fun_marriages
         (scope_key, user_jid, partner_jid, married_at)
         VALUES (?, ?, ?, ?)`
      );
      insert.run(s, a, b, ts);
      insert.run(s, b, a, ts);
      return { ok: true, reason: 'ok', partnerJid: b, marriedAt: ts };
    });

    return run();
  }

  function divorce({ userJid, scopeKey }) {
    ensureSchema();
    const db = getDatabase();
    const u = String(userJid || '').trim();
    const s = String(scopeKey || '').trim();
    if (!u || !s) return { ok: false, reason: 'invalid-identity' };

    const run = db.transaction(() => {
      const m = getMarriage(u, s);
      if (!m) return { ok: false, reason: 'not-married' };

      db.prepare(
        `DELETE FROM ${ANALYTICS_SCHEMA}.fun_marriages
         WHERE scope_key = ? AND (user_jid = ? OR user_jid = ?)`
      ).run(s, u, m.partnerJid);

      return { ok: true, reason: 'ok', partnerJid: m.partnerJid };
    });

    return run();
  }

  return {
    getMarriage,
    marry,
    divorce,
  };
}
