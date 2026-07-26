import { getDb } from '../../db/context.js';
import { ensureFunSchema as applyFunSchema } from '../schema.js';

const ANALYTICS_SCHEMA = 'analytics';

/** Unlocks por usuário que não devem sumir (ex.: chave de armas). */
const PERMANENT_EFFECT_KEYS = new Set(['weapons_license', 'title']);

function isPermanentEffect(effect) {
  if (!effect) return false;
  if (PERMANENT_EFFECT_KEYS.has(effect.effectKey)) return true;
  return Boolean(effect.payload?.permanent);
}

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

/** Efeitos timed que também exigem charges > 0 (ex.: passe de imunidade policial). */
function requiresChargesWhileTimed(effect) {
  if (!effect) return false;
  if (effect.payload?.useCharges) return true;
  return effect.effectKey === 'police_immunity';
}

function isEffectDepleted(effect, now = Date.now()) {
  if (!effect) return true;
  const ts = Number(now) || Date.now();
  if (effect.expiresAt > 0 && effect.expiresAt < ts) return true;
  if (requiresChargesWhileTimed(effect) && effect.charges <= 0) return true;
  if (
    effect.expiresAt === 0 &&
    effect.charges <= 0 &&
    effect.effectKey !== 'title' &&
    !isPermanentEffect(effect)
  ) {
    return true;
  }
  return false;
}

export function createFunEffectsRepository({ getDatabase = getDb } = {}) {
  function ensureSchema() {
    applyFunSchema(getDatabase());
  }

  function clearEffect(userJid, scopeKey, effectKey) {
    ensureSchema();
    getDatabase()
      .prepare(
        `DELETE FROM ${ANALYTICS_SCHEMA}.fun_user_effects
         WHERE user_jid = ? AND scope_key = ? AND effect_key = ?`
      )
      .run(String(userJid), String(scopeKey), String(effectKey));
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

    // timed expired / charges esgotadas em efeitos dual (passe policial)
    if (isEffectDepleted(effect, now)) {
      // auto-cleanup de passes expirados
      clearEffect(userJid, scopeKey, effectKey);
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
    const ts = Number(now) || Date.now();
    return rows
      .map(mapEffect)
      .filter((e) => {
        if (!e) return false;
        if (isEffectDepleted(e, ts)) {
          clearEffect(e.userJid, e.scopeKey, e.effectKey);
          return false;
        }
        if (e.expiresAt > 0) {
          if (requiresChargesWhileTimed(e)) return e.charges > 0;
          return true;
        }
        if (e.effectKey === 'title' || isPermanentEffect(e)) return true;
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

  /**
   * Efeito com duração E charges (não empilha: replace = true por padrão).
   * Usado pelo Crime Immunity Pass (3 dias OU 20 crimes).
   */
  function setTimedChargesEffect({
    userJid,
    scopeKey,
    effectKey,
    durationMs,
    charges = 1,
    payload = {},
    now = Date.now(),
    replace = true,
  }) {
    ensureSchema();
    const db = getDatabase();
    const ts = Number(now) || Date.now();
    const dur = Math.max(1000, Math.floor(Number(durationMs) || 0));
    const ch = Math.max(1, Math.floor(Number(charges) || 1));
    const existing = getEffect(userJid, scopeKey, effectKey, ts);
    let nextExpires = ts + dur;
    let nextCharges = ch;
    if (!replace && existing?.expiresAt > ts) {
      nextExpires = existing.expiresAt + dur;
      nextCharges = (Number(existing.charges) || 0) + ch;
    }
    const mergedPayload = {
      ...(payload || {}),
      useCharges: true,
    };
    db.prepare(
      `INSERT INTO ${ANALYTICS_SCHEMA}.fun_user_effects
       (user_jid, scope_key, effect_key, charges, expires_at, payload_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_jid, scope_key, effect_key) DO UPDATE SET
         charges = excluded.charges,
         expires_at = excluded.expires_at,
         payload_json = excluded.payload_json,
         updated_at = excluded.updated_at`
    ).run(
      String(userJid),
      String(scopeKey),
      String(effectKey),
      nextCharges,
      nextExpires,
      JSON.stringify(mergedPayload),
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
   * Unlocks permanentes (weapons_license etc.) nunca são consumidos.
   */
  function consumeCharge(userJid, scopeKey, effectKey, now = Date.now()) {
    ensureSchema();
    const db = getDatabase();
    const effect = getEffect(userJid, scopeKey, effectKey, now);
    if (!effect || effect.charges <= 0) return null;
    if (isPermanentEffect(effect)) return null;

    const next = effect.charges - 1;
    if (next <= 0) {
      clearEffect(userJid, scopeKey, effectKey);
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

  /** Roleta russa / morto virtual — bloqueia ganho de XP passivo. */
  function isXpBlocked(userJid, scopeKey, now = Date.now()) {
    const e = getEffect(userJid, scopeKey, 'xp_morto', now);
    if (!e || !(e.expiresAt > (Number(now) || Date.now()))) {
      return { blocked: false };
    }
    return {
      blocked: true,
      expiresAt: e.expiresAt,
      effectKey: 'xp_morto',
      source: e.payload?.source || 'russian',
    };
  }

  return {
    getEffect,
    listActiveEffects,
    setTimedEffect,
    setTimedChargesEffect,
    clearEffect,
    addCharges,
    consumeCharge,
    isXpBoostActive,
    isXpBlocked,
  };
}
