import { getDb } from '../../db/context.js';
import { ensureFunSchema as applyFunSchema } from '../schema.js';

const ANALYTICS_SCHEMA = 'analytics';

function mapEffect(row) {
  if (!row) return null;
  let payload = {};
  try {
    payload = JSON.parse(String(row.payload_json || '{}'));
  } catch {
    payload = {};
  }
  return {
    userJid: String(row.user_jid || ''),
    scopeKey: String(row.scope_key || ''),
    effectKey: String(row.effect_key || ''),
    charges: Number(row.charges) || 0,
    expiresAt: Number(row.expires_at) || 0,
    payload,
    updatedAt: Number(row.updated_at) || 0,
  };
}

export function createFunEffectsRepository({ getDatabase = getDb } = {}) {
  function ensureSchema() {
    applyFunSchema(getDatabase());
  }

  function getEffect(userJid, scopeKey, effectKey, now = Date.now()) {
    ensureSchema();
    const db = getDatabase();
    const row = db
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_user_effects
         WHERE user_jid = ? AND scope_key = ? AND effect_key = ?`
      )
      .get(String(userJid), String(scopeKey), String(effectKey));
    const effect = mapEffect(row);
    if (!effect) return null;

    // timed expired
    if (effect.expiresAt > 0 && effect.expiresAt < (Number(now) || Date.now())) {
      db.prepare(
        `DELETE FROM ${ANALYTICS_SCHEMA}.fun_user_effects
         WHERE user_jid = ? AND scope_key = ? AND effect_key = ?`
      ).run(String(userJid), String(scopeKey), String(effectKey));
      return null;
    }
    // charge depleted
    if (effect.expiresAt === 0 && effect.charges <= 0 && effect.effectKey !== 'title') {
      return null;
    }
    return effect;
  }

  function listActiveEffects(userJid, scopeKey, now = Date.now()) {
    ensureSchema();
    const db = getDatabase();
    const rows = db
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_user_effects
         WHERE user_jid = ? AND scope_key = ?`
      )
      .all(String(userJid), String(scopeKey));
    return rows
      .map(mapEffect)
      .filter(e => {
        if (!e) return false;
        if (e.expiresAt > 0) return e.expiresAt >= (Number(now) || Date.now());
        if (e.effectKey === 'title') return true;
        return e.charges > 0;
      });
  }

  function setTimedEffect({
    userJid,
    scopeKey,
    effectKey,
    durationMs,
    payload = {},
    now = Date.now(),
  }) {
    ensureSchema();
    const db = getDatabase();
    const ts = Number(now) || Date.now();
    const expiresAt = ts + Math.max(1000, Math.floor(Number(durationMs) || 0));
    // se já tem boost ativo, estende a partir do expires atual
    const existing = getEffect(userJid, scopeKey, effectKey, ts);
    let nextExpires = expiresAt;
    if (existing?.expiresAt > ts) {
      nextExpires = existing.expiresAt + Math.max(1000, Math.floor(Number(durationMs) || 0));
    }

    db.prepare(
      `INSERT INTO ${ANALYTICS_SCHEMA}.fun_user_effects
       (user_jid, scope_key, effect_key, charges, expires_at, payload_json, updated_at)
       VALUES (?, ?, ?, 0, ?, ?, ?)
       ON CONFLICT(user_jid, scope_key, effect_key) DO UPDATE SET
         expires_at = excluded.expires_at,
         payload_json = excluded.payload_json,
         updated_at = excluded.updated_at`
    ).run(
      String(userJid),
      String(scopeKey),
      String(effectKey),
      nextExpires,
      JSON.stringify(payload || {}),
      ts
    );
    return getEffect(userJid, scopeKey, effectKey, ts);
  }

  function addCharges({
    userJid,
    scopeKey,
    effectKey,
    charges = 1,
    payload = {},
    now = Date.now(),
  }) {
    ensureSchema();
    const db = getDatabase();
    const ts = Number(now) || Date.now();
    const add = Math.max(1, Math.floor(Number(charges) || 1));
    db.prepare(
      `INSERT INTO ${ANALYTICS_SCHEMA}.fun_user_effects
       (user_jid, scope_key, effect_key, charges, expires_at, payload_json, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)
       ON CONFLICT(user_jid, scope_key, effect_key) DO UPDATE SET
         charges = ${ANALYTICS_SCHEMA}.fun_user_effects.charges + excluded.charges,
         payload_json = excluded.payload_json,
         updated_at = excluded.updated_at`
    ).run(
      String(userJid),
      String(scopeKey),
      String(effectKey),
      add,
      JSON.stringify(payload || {}),
      ts
    );
    return getEffect(userJid, scopeKey, effectKey, ts);
  }

  /**
   * Consome 1 charge. Retorna effect consumido ou null.
   */
  function consumeCharge(userJid, scopeKey, effectKey, now = Date.now()) {
    ensureSchema();
    const db = getDatabase();
    const effect = getEffect(userJid, scopeKey, effectKey, now);
    if (!effect || effect.charges <= 0) return null;

    const next = effect.charges - 1;
    if (next <= 0) {
      db.prepare(
        `DELETE FROM ${ANALYTICS_SCHEMA}.fun_user_effects
         WHERE user_jid = ? AND scope_key = ? AND effect_key = ?`
      ).run(String(userJid), String(scopeKey), String(effectKey));
    } else {
      db.prepare(
        `UPDATE ${ANALYTICS_SCHEMA}.fun_user_effects
         SET charges = ?, updated_at = ?
         WHERE user_jid = ? AND scope_key = ? AND effect_key = ?`
      ).run(next, Number(now) || Date.now(), String(userJid), String(scopeKey), String(effectKey));
    }
    return effect;
  }

  function isXpBoostActive(userJid, scopeKey, now = Date.now()) {
    const e = getEffect(userJid, scopeKey, 'xp_boost', now);
    if (!e || e.expiresAt <= 0) return { active: false, multiplier: 1 };
    return {
      active: true,
      multiplier: Number(e.payload?.multiplier) || 2,
      expiresAt: e.expiresAt,
    };
  }

  return {
    getEffect,
    listActiveEffects,
    setTimedEffect,
    addCharges,
    consumeCharge,
    isXpBoostActive,
  };
}
